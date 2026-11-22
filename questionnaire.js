// NOI Optimization Workbook — questionnaire definition.
// Every section is saved as its own row in Supabase (table: responses),
// so different team members can work on different sections at the same time.

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const sum = (arr) => arr.reduce((a, b) => a + (num(b) || 0), 0);
const anyNum = (arr) => arr.some((v) => num(v) !== null);

const YESNO = ['Yes', 'Partially', 'No', 'Unsure'];
const TIMING = ['0–6 mo', '6–12 mo', '1–2 years'];
const PRIORITY3 = ['1', '2', '3'];
const SCORE = ['1', '2', '3', '4', '5'];

// Gross leasable area pulled from the Site Information section.
export function gla(all) {
  const s = all.site || {};
  const total = num(s.gla_total);
  if (total) return total;
  const parts = sum([s.gla_office, s.gla_retail]);
  return parts || null;
}

// Weighted priority score from Appendix C:
// 40% NOI impact + 20% ease + 15% risk reduction + 15% tenant value + 10% strategic, each 1–5, normalized to 100.
export function weightedScore(r) {
  const parts = [[r.impact, 0.4], [r.ease, 0.2], [r.risk, 0.15], [r.tenant, 0.15], [r.strategic, 0.1]];
  if (!parts.every(([v]) => num(v))) return null;
  return Math.round(parts.reduce((a, [v, w]) => a + num(v) * w, 0) / 5 * 100);
}
export function priorityBand(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return 'P1 — Immediate';
  if (score >= 65) return 'P2 — High';
  if (score >= 50) return 'P3 — Medium';
  return 'P4 — Monitor';
}

const OPEX_LINES = ['Cleaning', 'HVAC', 'Elevator', 'R&M', 'Energy / Utilities', 'Landscaping & Grounds', 'Security', 'Vacancy-related operating costs'];

const REVENUE_OPPS = [
  ['parking', 'Parking / Visitor Parking', 'Potential spaces × expected utilization × annual rate (or incremental parking revenue).', 'Incremental parking operations, staffing, maintenance, technology, taxes/fees, etc.'],
  ['ev', 'EV Charging / Mobility', 'Chargers/spaces × expected utilization × rate, plus any incentives or fees.', 'Electricity, maintenance, software, revenue share, network fees, etc.'],
  ['rooftop', 'Rooftop / Telecom / Antenna', 'Annual lease/licence fees from additional rooftop, telecom, antenna or equipment rights.', 'Incremental maintenance, access, insurance, management or other costs.'],
  ['signage', 'Signage / Advertising', 'Available locations × expected annual rate/fee.', 'Installation, maintenance, management, commissions, etc.'],
  ['amenity', 'Amenity / Meeting / Event Space', 'Usable hours/days × expected utilization × rate.', 'Cleaning, staffing, utilities, security, setup, etc.'],
  ['flex', 'Conference / Coworking / Flex Space', 'Usable SF or desks × expected utilization × rate.', 'Operating, staffing, utilities, technology, furniture, etc.'],
  ['storage', 'Storage / Locker / Bike Storage', 'Units/spaces × expected occupancy × annual rate.', 'Cleaning, maintenance, access control, administration, etc.'],
  ['retail', 'Retail / Food & Beverage / Vending', 'Rent/licence/commission/percentage rent or vending revenue.', 'Utilities, management, cleaning, commissions, etc.'],
  ['services', 'Tenant Services / Premium Services', 'Expected number of users/tenants × annual fee or margin.', 'Service delivery, staffing, technology, administration, etc.'],
  ['utility', 'Utility / Energy Recovery / Submetering', 'Recoverable utility/energy amount or annual recovery improvement.', 'Incremental metering, administration, billing, etc.'],
  ['other', 'Other Revenue Opportunity', 'Use the most appropriate volume × rate × utilization method.', 'All incremental costs directly attributable to the opportunity.'],
];

export const revenueNOI = (g) => {
  if (!g || g.na) return null;
  const c = anyNum([g.A, g.B]) ? (num(g.A) || 0) - (num(g.B) || 0) : null;
  if (c === null && num(g.D) === null) return null;
  return (c || 0) - (num(g.D) || 0);
};

export function appendixCTotal(all) {
  const a = all.appendix_c || {};
  const vals = REVENUE_OPPS.map(([k]) => revenueNOI(a[k])).filter((v) => v !== null);
  return vals.length ? sum(vals) : null;
}
export function opexCalTotal(all) {
  const rows = (all.gm_opex || {}).opex_cal || {};
  const vals = Object.values(rows).map((r) => r && r.opportunity);
  return anyNum(vals) ? sum(vals) : null;
}
export function propertyTaxTotal(all) {
  const rows = (all.gm_tax || {}).ptax || {};
  const vals = ['office_occupied', 'office_vacant', 'retail_occupied', 'retail_vacant'].map((k) => rows[k] && rows[k].conservative);
  return anyNum(vals) ? sum(vals) : null;
}
export function energyTotal(all) {
  const rows = ((all.sustainability || {}).energy_lines) || [];
  const vals = rows.map((r) => (num(r.cost) !== null && num(r.reduction) !== null ? num(r.cost) * num(r.reduction) / 100 : null));
  return anyNum(vals) ? sum(vals) : null;
}
export function registerTotal(all) {
  const rows = (all.gm_priority || {}).register || {};
  const vals = Object.values(rows).map((r) => r && r.noi);
  return anyNum(vals) ? sum(vals) : null;
}
export function investmentTotal(all) {
  const rows = (all.gm_priority || {}).matrix || [];
  const vals = rows.map((r) => r && r.investment);
  return anyNum(vals) ? sum(vals) : null;
}

// Running ledger shown in the side rail.
export function ledger(all) {
  return [
    { label: 'Expense calibration', value: opexCalTotal(all), section: 'gm_opex' },
    { label: 'Property tax (conservative)', value: propertyTaxTotal(all), section: 'gm_tax' },
    { label: 'Other revenue', value: appendixCTotal(all), section: 'appendix_c' },
    { label: 'Energy savings', value: energyTotal(all), section: 'sustainability' },
  ];
}


// Roles a person can pick at sign-up. Each section lists the roles that answer it;
// people only see (and can only save) the sections for their role(s).
export const ROLES = [
  { key: 'director', label: 'Account Lead / Director' },
  { key: 'gm', label: 'General Manager (GM)' , short: 'GM' },
  { key: 'pm', label: 'Property Manager (PM)' , short: 'PM' },
  { key: 'apm', label: 'Assistant Property Manager (APM)' , short: 'APM' },
  { key: 'ops_tech', label: 'Operations — Technical' },
  { key: 'ops_security', label: 'Operations — Security' },
  { key: 'accounting', label: 'Accounting — Controller / Manager' },
  { key: 'leasing', label: 'Leasing' },
  { key: 'lease_admin', label: 'Lease Administration' },
  { key: 'sustainability', label: 'Sustainability Lead' },
  { key: 'proptech', label: 'Prop Tech Lead' },
];
export const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));
export const ROLE_SHORT = Object.fromEntries(ROLES.map((r) => [r.key, r.short || r.label]));
const ALL = 'all';

// ---------------------------------------------------------------------------

export const GROUPS = [
  { key: 'setup', label: 'Getting started' },
  { key: 'leadership', label: 'Leadership & market' },
  { key: 'gmpm', label: 'GM / PM' },
  { key: 'specialists', label: 'Specialist leads' },
  { key: 'appendix', label: 'Appendices' },
  { key: 'signoff', label: 'Sign-off' },
];

export const SECTIONS = [
  // ---------------------------------------------------------------- setup
  {
    key: 'overview', group: 'setup', title: 'How this works', roles: ALL, noProgress: true,
    fields: [
      { type: 'info', html: `
        <p><strong>Purpose:</strong> quantify the asset's operating performance, identify NOI improvement opportunities, estimate annual NOI upside and prioritize initiatives. We want to understand:</p>
        <ol><li>Where NOI is being lost or under-realized</li><li>What operational lever can improve it</li><li>The estimated annual NOI opportunity</li><li>What should be prioritized first</li></ol>
        <p>The questionnaire is grouped by category so the person with the subject-matter expertise can take ownership of the section relevant to their role. Each of us takes a slice of the work — combined, the hope is that it creates a bigger pie.</p>
        <p><strong>Instructions:</strong> select the response that most accurately reflects current operating conditions. Where financial or operating data is requested, use actual trailing-12-month or latest approved budget information where available. Everything saves automatically as you type.</p>` },
      { type: 'table', id: 'drivers', label: 'NOI drivers assessed in this questionnaire', readonly: true,
        columns: [{ key: 'q', label: 'Primary financial question(s)', type: 'static' }],
        rows: [
          { key: 'rev', label: 'Revenue optimization', static: { q: 'Are there additional revenue opportunities property management can drive? Parking, storage, signage/advertising, amenities, meeting/conference facilities, other ancillary income, vacant-space pop-ups, underutilized area activations.' } },
          { key: 'leasing', label: 'Leasing support', static: { q: 'Can operations improve leasing competitiveness, retention, recoveries and revenue?' } },
          { key: 'opex', label: 'Operating expense optimization', static: { q: 'Where can controllable expenses be reduced without impairing the asset? Where can contracts, scope and procurement be optimized?' } },
          { key: 'tenant', label: 'Tenant engagement & retention', static: { q: 'Can better service enhance leasing momentum and support retention?' } },
          { key: 'energy', label: 'Energy & sustainability', static: { q: 'Where can utility costs be reduced while supporting leasing? The objective is NOI impact; if the client has prioritized ESG this can include both.' } },
          { key: 'risk', label: 'Risk & NOI protection', static: { q: 'What NOI is at risk and what can be protected?' } },
          { key: 'capital', label: 'Capital & operational efficiency', static: { q: 'Which capital initiatives improve NOI, leasing or lifecycle economics?' } },
          { key: 'data', label: 'Data & KPI management', static: { q: 'Does management have the information needed to continuously optimize NOI?' } },
        ] },
      { type: 'info', html: `
        <h4>Putting it all together (Appendix A)</h4>
        <ul>
          <li><strong>Annual NOI opportunity</strong> = recurring annual revenue increase + recurring annual expense reduction − incremental recurring operating cost.</li>
          <li><strong>NOI opportunity / SF</strong> = annual NOI opportunity ÷ gross building area.</li>
          <li><strong>First-year net benefit</strong> = annual NOI opportunity − one-time implementation investment.</li>
          <li><strong>Simple payback (years)</strong> = one-time investment ÷ annual NOI opportunity.</li>
          <li>Where a benefit is uncertain, use a probability-adjusted value: expected NOI opportunity = gross opportunity × probability of capture.</li>
        </ul>
        <p class="muted">Helpful supporting documents: latest annual budget, trailing-12-month operating statement, utility consumption/cost data, major service contracts, occupancy/tenant information, capital plan and tenant satisfaction/engagement data.</p>` },
    ],
  },
  {
    key: 'site', group: 'setup', title: 'Site team & asset information', roles: ['pm', 'apm', 'gm'],
    fields: [
      { type: 'table', id: 'team', label: 'Site team',
        columns: [{ key: 'names', label: 'Team members', type: 'text' }],
        rows: ['GM / Director', 'PM', 'APM', 'Operations — Technical', 'Operations — Security', 'Accounting — Controller', 'Accounting — Manager'].map((l, i) => ({ key: 'r' + i, label: l })) },
      { type: 'heading', text: 'Asset information' },
      { id: 'property_name', type: 'text', label: 'Property name' },
      { id: 'property_address', type: 'text', label: 'Property address' },
      { id: 'asset_class', type: 'select', label: 'Asset class', options: ['AAA', 'A', 'B', 'C', 'Mixed use', 'Other'] },
      { id: 'year_built', type: 'number', label: 'Year built', half: true },
      { id: 'managed_since', type: 'number', label: 'Managed since (year)', half: true },
      { id: 'owner', type: 'text', label: 'Owner' },
      { id: 'gla_total', type: 'number', unit: 'SF', label: 'Gross leasable area (GLA)', help: 'Used to calculate every $/SF figure in the workbook.' },
      { id: 'gla_office', type: 'number', unit: 'SF', label: 'GLA — office', half: true },
      { id: 'gla_retail', type: 'number', unit: 'SF', label: 'GLA — retail', half: true },
      { id: 'occ_office', type: 'percent', label: 'SF occupied — office', half: true },
      { id: 'occ_retail', type: 'percent', label: 'SF occupied — retail', half: true },
      { id: 'date_completed', type: 'date', label: 'Date completed', half: true },
      { id: 'fiscal_year', type: 'text', label: 'Fiscal year', half: true },
      { id: 'last_bca', type: 'date', label: 'Date of last BCA', half: true },
    ],
  },

  // ----------------------------------------------------------- leadership
  {
    key: 'director', group: 'leadership', title: 'Owner investment priorities', roles: ['director'],
    fields: [
      { id: 'hold', type: 'radio', label: 'Is the asset intended to be a long-term or short-term hold?', help: 'This helps guide capital strategy and decisions.', options: ['Long-term hold', 'Short-term hold', 'Undetermined'] },
      { id: 'hold_notes', type: 'textarea', label: 'Hold strategy notes' },
      { id: 'corp_priorities', type: 'textarea', label: "What are the owner's investment priorities from a corporate standpoint?" },
      { id: 'asset_priorities', type: 'checks', label: 'Priorities for this asset (select all that apply)', options: ['Long-term and stable tenancies (vs. short-term hold / flip)', 'Rent growth', 'Improving occupancy & NOI', 'Diversification', 'Decarbonization'], other: true },
    ],
  },
  {
    key: 'leasing', group: 'leadership', title: 'Leasing & market conditions', roles: ['director', 'leasing'],
    fields: [
      { id: 'market', type: 'textarea', label: 'What are current conditions in the market for this site?' },
      { id: 'compset_date', type: 'date', label: 'Competitive set — as of' },
      { type: 'table', id: 'compset', label: 'Competitive set — leasing', scroll: true,
        columns: [
          { key: 'subject', label: 'Subject site', type: 'text', accent: true },
          { key: 'c1', label: 'Comp 1', type: 'text' }, { key: 'c2', label: 'Comp 2', type: 'text' },
          { key: 'c3', label: 'Comp 3', type: 'text' }, { key: 'c4', label: 'Comp 4', type: 'text' },
        ],
        rows: [['name', 'Building'], ['address', 'Address'], ['ownership', 'Ownership'], ['class', 'Class'], ['gla', 'Size (SF) GLA'], ['floors', 'Floors'], ['year', 'Year built'], ['vacant', 'Vacant space (SF)'], ['vacancy', 'Vacancy rate (%)'], ['asking', 'Asking net rent PSF'], ['ops', 'Ops PSF', true], ['taxes', 'Taxes PSF', true], ['utilities', 'Utilities PSF', true], ['addl', "Add'l rent PSF"], ['gross', 'Gross rent PSF']]
          .map(([key, label, sub]) => ({ key, label, sub })) },
      { id: 'expiry', type: 'textarea', label: 'Expiry profile', help: 'Document the tenant expiry profile for the coming 12 months. How much square footage is at risk?' },
      { id: 'expiry_sf', type: 'number', unit: 'SF', label: 'Square footage at risk (next 12 months)', half: true },
      { id: 'identity', type: 'textarea', label: 'Building identity & positioning', help: 'How is leasing currently positioning the building (identity / personality)? How can operations support, align or amplify it? Does a strategy need to be put in place to curate one?' },
      { type: 'heading', text: 'What can PM do to further support leasing momentum?' },
      { id: 'ask_process', type: 'textarea', label: 'Operational process / ideas' },
      { id: 'ask_rm', type: 'textarea', label: 'Maintenance (R&M)' },
      { id: 'ask_capital', type: 'textarea', label: 'Building enhancements (capital budget)' },
    ],
  },
  {
    key: 'accounting', group: 'leadership', title: 'Accounting', roles: ['accounting'],
    fields: [
      { type: 'table', id: 'benchmark', label: 'Operational cost benchmarking — comparable sites', scroll: true,
        help: 'Enter annual $ or $/SF consistently across columns. The benchmark average is calculated from the comparables.',
        columns: [
          { key: 'downtown', label: 'Downtown', type: 'currency' },
          { key: 'p1', label: 'Property 1', type: 'currency' }, { key: 'p2', label: 'Property 2', type: 'currency' }, { key: 'p3', label: 'Property 3', type: 'currency' },
          { key: 'avg', label: 'Benchmark average', type: 'calc', format: 'currency', compute: (r) => { const v = [r.downtown, r.p1, r.p2, r.p3].filter((x) => num(x) !== null); return v.length ? sum(v) / v.length : null; } },
          { key: 'subject', label: 'This property', type: 'currency', accent: true },
        ],
        rows: [['names', 'Property name', 'text'], ['gla', 'GLA (SF)', 'number'], ['occ', 'Occupancy (%)', 'number'],
          ['cleaning', 'Total cleaning'], ['hvac', 'Total HVAC'], ['elevator', 'Total elevator'], ['rm', 'Total R&M'], ['utilities', 'Total utilities'], ['landscaping', 'Total landscaping & grounds'], ['security', 'Total security & safety'], ['admin', 'Total admin'], ['insurance', 'Total insurance'],
          ['rec_opex', 'Recoverable operating expenses', null, true], ['mgmt_fees', 'Recoverable management fees'], ['rec_admin', 'Total recoverable opex plus admin fee', null, true], ['tax', 'Recoverable property tax'], ['rec_total', 'Total recoverable expenses plus admin fee', null, true]]
          .map(([key, label, type, bold]) => ({ key, label, bold, cellType: type })) },
      { type: 'heading', text: 'NOI' },
      { id: 'noi_current', type: 'currency', label: 'Current annual NOI', half: true },
      { id: 'noi_trend', type: 'textarea', label: 'NOI trend (historical)' },
      { type: 'table', id: 'opex_summary', label: 'Occupancy & operating expenses',
        columns: [
          { key: 'annual', label: 'Annual', type: 'currency' },
          { key: 'psf', label: 'PSF', type: 'calc', format: 'currency2', compute: (r, ctx) => (num(r.annual) !== null && ctx.gla ? num(r.annual) / ctx.gla : null) },
        ],
        rows: [{ key: 'occupancy', label: 'Current occupancy (%)', cellType: 'percent', noCalc: true }, { key: 'opex', label: 'Annual operating expenses' }, { key: 'controllable', label: 'Controllable operating expenses' }, { key: 'recoverable', label: 'Recoverable operating expenses' }] },
      { type: 'heading', text: 'NOI slippage (controllable by PMs)' },
      { id: 'slip_vacant_util', type: 'currency', label: 'Vacant unit utilities (annual)', half: true },
      { id: 'slip_other', type: 'textarea', label: 'Other slippage' },
    ],
  },

  // ------------------------------------------------------------------ GM/PM
  {
    key: 'gm_swot', group: 'gmpm', title: 'SWOT & technical priorities', roles: ['gm', 'pm', 'apm', 'ops_tech'],
    fields: [
      { type: 'info', html: '<p>Where available, pre-populate from ESPM energy audits and BCAs, then review as a team.</p>' },
      { id: 'strengths', type: 'textarea', label: 'Strengths', half: true, rows: 5 },
      { id: 'weaknesses', type: 'textarea', label: 'Weaknesses', half: true, rows: 5 },
      { id: 'opportunities', type: 'textarea', label: 'Opportunities', half: true, rows: 5 },
      { id: 'threats', type: 'textarea', label: 'Threats / challenges', half: true, rows: 5 },
      { type: 'heading', text: 'Technical review — high priorities', sub: 'Highlight key issues such as life safety, building operating disruption (e.g. elevators), roof and foundation. Pre-populate BCA recommendations, then advise if anything needs to be re-prioritized.' },
      { type: 'table', id: 'technical',
        columns: [{ key: 'p1', label: 'Priority 1', type: 'textarea' }, { key: 'p2', label: 'Priority 2', type: 'textarea' }, { key: 'p3', label: 'Priority 3', type: 'textarea' }],
        rows: [{ key: 'item', label: 'Item / system' }, { key: 'obs', label: 'Observations' }, { key: 'implication', label: 'Implication' }, { key: 'capex', label: 'Included in CapEx?' }, { key: 'project', label: 'Project opportunity' }] },
      { id: 'technical_photos', type: 'photos', label: 'Photos of priority items (optional)', max: 6 },
    ],
  },
  {
    key: 'gm_opex', group: 'gmpm', title: 'Operating cost calibration & contracts', roles: ['gm', 'pm', 'apm'],
    fields: [
      { type: 'info', html: '<p><em>By optimizing controllable operational levers and expenses, we can support our owners in growing asset NOI. How can we lower costs and/or increase value on the operating line items?</em> Calibration worksheets are in Appendix B.</p>' },
      { type: 'table', id: 'opex_cal', label: 'Table 1(c) — Operating expense calibration & contract optimization', scroll: true,
        columns: [
          { key: 'driver', label: 'Driver (SF, # units, services…)', type: 'text' },
          { key: 'baseline', label: 'Annual current cost (baseline)', type: 'currency' },
          { key: 'psf', label: 'Current PSF', type: 'calc', format: 'currency2', compute: (r, ctx) => (num(r.baseline) !== null && ctx.gla ? num(r.baseline) / ctx.gla : null) },
          { key: 'benchmark', label: 'Benchmark cost PSF', type: 'currency' },
          { key: 'over', label: 'Over / under benchmark', type: 'calc', format: 'flag', compute: (r, ctx) => {
            if (num(r.benchmark) === null || num(r.baseline) === null || !ctx.gla) return null;
            const d = num(r.baseline) / ctx.gla - num(r.benchmark);
            return d > 0.005 ? 'Over' : d < -0.005 ? 'Under' : 'At';
          } },
          { key: 'scope', label: 'Scope commentary (is the site realizing additional scope/value?)', type: 'textarea' },
          { key: 'measures', label: 'Calibration measures / opportunities', type: 'textarea' },
          { key: 'opportunity', label: 'Annual est. NOI opportunity / savings', type: 'currency', total: true },
          { key: 'investment', label: 'Investment', type: 'currency', total: true },
          { key: 'payback', label: 'Payback (yrs)', type: 'calc', format: 'years', compute: (r) => (num(r.investment) && num(r.opportunity) ? num(r.investment) / num(r.opportunity) : null) },
          { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY3 },
        ],
        rows: OPEX_LINES.map((l, i) => ({ key: 'l' + i, label: l })),
        footer: 'Total — operating expense calibration' },
      { type: 'heading', text: 'Contract optimization' },
      { id: 'contract_freq', type: 'radio', label: 'How frequently are service contracts reviewed for scope optimization?', options: ['At renewal', 'Occasionally', 'Annually', 'Quarterly'] },
      { id: 'procurement', type: 'yesno', label: 'Are procurement opportunities actively identified (e.g. preferred vendors) to take advantage of preferred pricing or scope?' },
      { id: 'eliminate', type: 'yesno', label: 'Is there a process for identifying services that can be eliminated, consolidated or redesigned?' },
      { id: 'unnecessary', type: 'yesno', label: 'Are vendor scopes reviewed for unnecessary services?' },
      { id: 'msa', type: 'yesno', label: 'Are vendor MSAs linked to measurable building outcomes?' },
      { id: 'afterhours', type: 'yesno', label: 'Are after-hours services tracked and charged back where appropriate?' },
      { id: 'contract_notes', type: 'textarea', label: 'Comments' },
    ],
  },
  {
    key: 'gm_tax', group: 'gmpm', title: 'Insurance & property tax', roles: ['gm', 'pm', 'apm'],
    fields: [
      { id: 'insurance', type: 'textarea', label: 'Insurance cost calibration', help: 'Current premium, trend, coverage changes and any calibration opportunities.', rows: 5 },
      { id: 'insurance_savings', type: 'currency', label: 'Estimated annual insurance savings', half: true },
      { type: 'table', id: 'ptax', label: 'Property tax calibration', scroll: true,
        columns: [
          { key: 'current', label: 'Current amt PSF', type: 'currency' },
          { key: 'reduce', label: 'Reduce range PSF (projected)', type: 'text' },
          { key: 'savings_psf', label: 'Est. tax savings PSF', type: 'currency' },
          { key: 'sf', label: 'Total SF (2027 budget)', type: 'number' },
          { key: 'conservative', label: 'Est. savings / yr — conservative', type: 'currency' },
          { key: 'aggressive', label: 'Est. savings / yr — aggressive', type: 'currency' },
          { key: 'realization', label: 'Savings benefit realization', type: 'text' },
        ],
        rows: [
          { key: 'office_h', label: 'Office', heading: true },
          { key: 'office_occupied', label: 'Occupied' }, { key: 'office_vacant', label: 'Vacant' },
          { key: 'office_total', label: 'Total — office', calcRow: ['office_occupied', 'office_vacant'] },
          { key: 'retail_h', label: 'Retail', heading: true },
          { key: 'retail_occupied', label: 'Occupied' }, { key: 'retail_vacant', label: 'Vacant' },
          { key: 'retail_total', label: 'Total — retail', calcRow: ['retail_occupied', 'retail_vacant'] },
        ] },
      { id: 'ptax_start', type: 'date', label: 'Tax savings expected to start', half: true },
    ],
  },
  {
    key: 'gm_revenue', group: 'gmpm', title: 'Other revenue opportunities', roles: ['gm', 'pm', 'apm'],
    fields: [
      { id: 'revenue_opps', type: 'checks', label: 'Check all that currently apply or may apply to the asset', help: 'Current or potential new revenue opportunities as they relate to property management — not leasing metrics.',
        options: ['Parking', 'EV charging', 'Rooftop / telecom', 'Signage / advertising', 'Amenity / event space', 'Conference / coworking / flex space', 'Storage / locker / bike storage', 'Retail / F&B / vending', 'Tenant services', 'Utility / energy recovery', 'Other opportunities'] },
      { type: 'info', html: '<p>For each opportunity selected, complete its calculation in <a href="#" data-goto="appendix_c">Appendix C — Other revenue calculations</a> to estimate the NOI impact.</p>' },
      { id: 'revenue_notes', type: 'textarea', label: 'Notes' },
    ],
  },
  {
    key: 'gm_priority', group: 'gmpm', title: 'Prioritization & NOI register', roles: ['gm', 'pm'],
    fields: [
      { type: 'info', html: `<p>Score each opportunity 1–5 on NOI impact, ease of implementation, risk reduction, tenant value and strategic value. The weighted score (40 / 20 / 15 / 15 / 10) is normalized to 100 and sets the priority:</p>
        <table class="mini"><tr><td>80–100</td><td><b>P1 — Immediate</b></td><td>Implement / business-case immediately (0–90 days)</td></tr>
        <tr><td>65–79</td><td><b>P2 — High</b></td><td>Develop implementation plan within 90 days</td></tr>
        <tr><td>50–64</td><td><b>P3 — Medium</b></td><td>Evaluate and include in annual optimization plan</td></tr>
        <tr><td>&lt;50</td><td><b>P4 — Monitor</b></td><td>Monitor, validate or defer</td></tr></table>` },
      { type: 'table', id: 'matrix', label: 'Prioritization matrix — NOI opportunities', dynamic: { min: 5, max: 20, addLabel: 'Add opportunity' }, scroll: true,
        columns: [
          { key: 'name', label: 'Opportunity', type: 'text', wide: true },
          { key: 'noi', label: 'Annual NOI', type: 'currency', total: true },
          { key: 'investment', label: 'Investment', type: 'currency', total: true },
          { key: 'payback', label: 'Payback (yrs)', type: 'calc', format: 'years', compute: (r) => (num(r.investment) && num(r.noi) ? num(r.investment) / num(r.noi) : null) },
          { key: 'impact', label: 'Impact', type: 'score' },
          { key: 'ease', label: 'Ease', type: 'score' },
          { key: 'risk', label: 'Risk', type: 'score' },
          { key: 'tenant', label: 'Tenant value', type: 'score' },
          { key: 'strategic', label: 'Strategic', type: 'score' },
          { key: 'raw', label: 'Score / 20', type: 'calc', format: 'int', compute: (r) => (anyNum([r.impact, r.ease, r.risk, r.tenant]) ? sum([r.impact, r.ease, r.risk, r.tenant]) : null) },
          { key: 'weighted', label: 'Weighted / 100', type: 'calc', format: 'int', compute: (r) => weightedScore(r) },
          { key: 'band', label: 'Priority', type: 'calc', format: 'band', compute: (r) => priorityBand(weightedScore(r)) },
        ] },
      { type: 'heading', text: 'NOI opportunity register', sub: 'Grey placeholder values are calculated from elsewhere in the workbook — type over them to confirm.' },
      { type: 'table', id: 'register', scroll: true,
        columns: [
          { key: 'noi', label: 'Est. annual NOI increase', type: 'currency', total: true, placeholder: (row, ctx) => ctx.registerHint(row) },
          { key: 'psf', label: 'NOI opportunity PSF', type: 'calc', format: 'currency2', compute: (r, ctx) => (num(r.noi) !== null && ctx.gla ? num(r.noi) / ctx.gla : null) },
          { key: 'timing', label: 'Timing', type: 'select', options: TIMING },
          { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY3 },
        ],
        rows: [
          { key: 'lease', label: 'Lease optimization', defaults: { priority: '1' } },
          { key: 'other_rev', label: 'Other revenue optimization', defaults: { priority: '3' }, hint: 'appendix_c' },
          { key: 'opex_h', label: 'Operating expense calibration (Table 1c)', heading: true },
          ...OPEX_LINES.slice(0, 7).map((l, i) => ({ key: 'opex_l' + i, label: l, sub: true, hint: 'opex:l' + i, defaults: { priority: '1' } })),
          { key: 'insurance', label: 'Insurance calibration', hint: 'insurance' },
          { key: 'ptax', label: 'Property tax calibration', defaults: { priority: '2' }, hint: 'ptax' },
          { key: 'energy', label: 'Energy savings', hint: 'energy' },
          { key: 'other1', label: 'Other', editableLabel: true },
          { key: 'other2', label: 'Other', editableLabel: true },
        ],
        footer: 'Total identified NOI opportunity' },
    ],
  },
  {
    key: 'gm_risk', group: 'gmpm', title: 'Risk & capital projects', roles: ['gm', 'pm', 'ops_tech', 'ops_security'], optional: true,
    fields: [
      { type: 'heading', text: 'Risk' },
      { id: 'risk_quantify', type: 'yesno', label: 'Does the site team quantify the potential NOI impact of major operational risks?' },
      { id: 'risk_emergency', type: 'textarea', label: 'What are the top 3 emergency scenarios operationally, and how frequently are they tested?' },
      { type: 'info', html: '<p><strong>NOI exposure</strong> — the building may operate well today, but its future NOI could be exposed.</p>' },
      { id: 'exp_leases', type: 'textarea', label: 'Lease expiries in the next 24 months — NOI impact' },
      { id: 'exp_redundancy', type: 'textarea', label: 'Equipment redundancy' },
      { id: 'exp_insurance', type: 'radio', label: 'Insurance costs are trending', options: ['Up', 'Flat', 'Down'] },
      { id: 'exp_capital', type: 'textarea', label: 'Major capital requirements — have they been funded?' },
      { id: 'risk_index', type: 'slider', label: 'NOI risk index', help: '0 = minimal risk, 100 = severe NOI exposure', min: 0, max: 100 },
      { type: 'heading', text: 'Capital projects' },
      { id: 'cap_framework', type: 'yesno', label: 'Has the owner communicated the decision-making framework and priorities for capital projects?' },
      { id: 'cap_top3', type: 'textarea', label: "If yes, what are the owner's top 3 priorities?" },
      { id: 'cap_how', type: 'textarea', label: 'How are capital projects prioritized?' },
      { id: 'cap_rank', type: 'rank', label: 'Rank how decisions are made — most priority at the top', help: 'There is no right answer. Use the arrows to reorder.', items: ['Life safety', 'Impact on NOI', 'Impact on leasing', 'Impact on reducing future operating expenses'] },
      { id: 'cap_reduce', type: 'yesno', label: 'Does the site team identify capital projects that can reduce future operating expenses?' },
    ],
  },
  {
    key: 'gm_data', group: 'gmpm', title: 'Data, KPIs & NOI management', roles: ['gm', 'pm', 'apm'],
    fields: [
      { id: 'kpi_dashboard', type: 'yesno', label: 'Does the site team keep a dashboard showing key operating costs?' },
      { id: 'kpi_psf', type: 'yesno', label: 'Are operating costs tracked on a $/PSF basis?' },
      { id: 'kpi_controllable', type: 'yesno', label: 'Are controllable expenses separated from non-controllable expenses?' },
      { id: 'kpi_compare', type: 'yesno', label: 'Are operating expenses compared against budget, prior year and market benchmarks?' },
      { id: 'kpi_tracked', type: 'yesno', label: 'Are operational savings and revenue opportunities tracked after implementation?' },
      { id: 'kpi_notes', type: 'textarea', label: 'Comments / recommendations' },
    ],
  },
  {
    key: 'tenant', group: 'gmpm', title: 'Tenant engagement & building identity', roles: ['gm', 'pm', 'apm'],
    fields: [
      { type: 'heading', text: 'Site activation' },
      { id: 'photos_exterior', type: 'photos', label: 'Exterior of the site (4 images)', max: 4 },
      { id: 'photos_lobby', type: 'photos', label: 'Lobby and common areas (4 images)', max: 4 },
      { id: 'activate_ext', type: 'checks', label: 'Opportunities to elevate exterior spaces', options: ['Landscaping', 'Signage', 'Sculpture', 'Mural art', 'Furniture', 'Vinyl'], other: true },
      { id: 'activate_int', type: 'checks', label: 'Opportunities to elevate interior spaces', options: ['Concierge / hospitality clothing (vs. security)', 'Signage', 'Wayfinding', 'Interior furniture', 'Vinyl'], other: true },
      { id: 'identity', type: 'textarea', label: 'Does the building have an identity / personality?', help: 'Unified signage, on-site activation, communication. Would a distinct personality support leasing and programming in terms of alignment and brand building?' },
      { id: 'activation_goals', type: 'textarea', label: 'Site activation goals', help: 'Positioning, streetscape, identity. What would the owners like the site to be regarded as, in one line? A neighbourhood destination? Street presence? Drawing foot traffic? Differentiated among office assets?' },
      { id: 'identity_start', type: 'textarea', label: 'Starting points for an identity', help: "Themes that reflect the owner's values (ESG or other), and the demographics of the neighbourhood and occupant base." },
      { type: 'heading', text: 'Amenities' },
      { id: 'amenities_existing', type: 'textarea', label: 'What are the existing amenities in the building?' },
      { id: 'amenities_data', type: 'yesno', label: 'Is tenant utilization data used to optimize building services?' },
      { id: 'amenities_wanted', type: 'textarea', label: 'What additional amenities has leasing said may help advance leasing momentum?' },
      { id: 'amenities_funds', type: 'radio', label: 'Are funds allocated in the budget?', options: ['Yes, allocated', 'Can be allocated', 'No'] },
      { type: 'heading', text: 'Programming' },
      { id: 'prog_existing', type: 'textarea', label: 'What is the existing programming / tenant engagement program on site?' },
      { id: 'prog_formal', type: 'radio', label: 'How is the program planned?', options: ['Formal annual program set the year before', 'Ad hoc, event by event', 'No program'] },
      { id: 'prog_spend', type: 'currency', label: 'Annual programming spend', half: true },
      { id: 'prog_pct', type: 'percent', label: '% of operating budget', half: true },
      { id: 'prog_office2', type: 'radio', label: 'Are you using Office 2.0 tenant engagement programming (standardized scope and preferred pricing)?', options: ['Yes', 'No — worth exploring', 'No'] },
      { type: 'info', html: '<p class="muted">Retention → vacancy avoidance → NOI preservation. Amenity utilization → tenant satisfaction → leasing performance.</p>' },
    ],
  },
  {
    key: 'summary', group: 'gmpm', title: 'PM submission summary', roles: ['pm', 'gm'],
    fields: [
      { type: 'calc', half: true, label: 'Total quantified annual NOI opportunity', format: 'currency', compute: (ctx) => registerTotal(ctx.all), help: 'From the NOI opportunity register.' },
      { type: 'calc', half: true, label: 'NOI opportunity / SF', format: 'currency2', compute: (ctx) => { const t = registerTotal(ctx.all); return t !== null && ctx.gla ? t / ctx.gla : null; } },
      { type: 'calc', half: true, label: 'Total required investment', format: 'currency', compute: (ctx) => investmentTotal(ctx.all), help: 'From the prioritization matrix.' },
      { type: 'calc', half: true, label: 'Simple payback', format: 'years', compute: (ctx) => { const t = registerTotal(ctx.all), i = investmentTotal(ctx.all); return t && i ? i / t : null; } },
      { id: 'top1', type: 'text', label: 'Top priority initiative #1', suggest: 0 },
      { id: 'top2', type: 'text', label: 'Top priority initiative #2', suggest: 1 },
      { id: 'top3', type: 'text', label: 'Top priority initiative #3', suggest: 2 },
      { id: 'summary_notes', type: 'textarea', label: 'Additional notes for ownership' },
    ],
  },

  // ------------------------------------------------------------ specialists
  {
    key: 'leaseadmin', group: 'specialists', title: 'Lease administration', roles: ['lease_admin'],
    fields: [
      { id: 'charge_more', type: 'textarea', label: 'Any opportunity to charge more? For which leases? Impact?' },
      { id: 'charge_more_impact', type: 'currency', label: 'Estimated annual impact', half: true },
      { id: 'recover_more', type: 'textarea', label: 'Any opportunities to recover more expenses from certain tenants? For which leases? Impact?' },
      { id: 'recover_more_impact', type: 'currency', label: 'Estimated annual impact', half: true },
    ],
  },
  {
    key: 'sustainability', group: 'specialists', title: 'Sustainability', roles: ['sustainability'],
    fields: [
      { type: 'heading', text: 'Part A — NOI opportunity & expense reduction' },
      { id: 'energy_psf', type: 'number', label: 'Energy consumption / SF', unit: 'ekWh/SF', third: true },
      { id: 'elec_psf', type: 'currency', label: 'Electricity cost / SF', third: true },
      { id: 'gas_psf', type: 'currency', label: 'Natural gas cost / SF', third: true },
      { type: 'table', id: 'energy_lines', label: 'Energy line items', help: 'Potential NOI improvement = current energy cost × estimated achievable reduction. E.g. $1,200,000 × 8% = $96,000 / year.',
        dynamic: { min: 3, max: 10, addLabel: 'Add line item', seed: ['Electricity', 'Natural gas', 'Water'] }, scroll: true,
        columns: [
          { key: 'name', label: 'Energy line item', type: 'text', wide: true },
          { key: 'cost', label: 'Current annual cost (a)', type: 'currency', total: true },
          { key: 'psf', label: 'Cost / PSF', type: 'calc', format: 'currency2', compute: (r, ctx) => (num(r.cost) !== null && ctx.gla ? num(r.cost) / ctx.gla : null) },
          { key: 'bench', label: 'Benchmark cost / PSF', type: 'currency' },
          { key: 'reduction', label: 'Achievable reduction % (b)', type: 'percent' },
          { key: 'noi', label: 'Potential NOI improvement', type: 'calc', format: 'currency', total: true, compute: (r) => (num(r.cost) !== null && num(r.reduction) !== null ? num(r.cost) * num(r.reduction) / 100 : null) },
        ],
        footer: 'Total annual energy costs' },
      { type: 'table', id: 'energy_mgmt', label: 'Energy management', help: 'Example: no energy management program → 5–10% cost reduction → $60–120K/year NOI opportunity → high priority → conduct a controls optimization assessment.',
        columns: [
          { key: 'has', label: 'Does the building have it?', type: 'select', options: ['Yes', 'Partial', 'No'] },
          { key: 'reduction', label: 'Est. energy cost reduction if introduced (%)', type: 'percent' },
          { key: 'noi', label: 'Est. NOI opportunity', type: 'currency', total: true },
        ],
        rows: ['Energy management program', 'HVAC scheduling', 'After-hours HVAC controls', 'Lighting controls', 'Submetering', 'Demand management', 'Preventative maintenance'].map((l, i) => ({ key: 'm' + i, label: l })),
        footer: 'Total' },
      { type: 'heading', text: 'Part B — Presentation development' },
      { id: 'certifications', type: 'textarea', label: 'Certification and incentive updates' },
      { id: 'owner_goals', type: 'textarea', label: 'Owner sustainability goals' },
      { id: 'property_goals', type: 'textarea', label: 'Sustainability goals at the property' },
      { id: 'progress_achieved', type: 'textarea', label: 'Selected achievements 2020–2025', third: true, rows: 5 },
      { id: 'progress_planned', type: 'textarea', label: 'Planned initiatives 2026–2030', third: true, rows: 5 },
      { id: 'progress_vision', type: 'textarea', label: 'Long-term vision beyond 2030', third: true, rows: 5 },
      { type: 'heading', text: 'Part C — Sustainability → NOI', sub: 'Capital cost → annual savings → NOI impact → payback. Helps owners tell apart good sustainability initiatives from initiatives that improve NOI.' },
      { type: 'table', id: 'capex', dynamic: { min: 3, max: 15, addLabel: 'Add initiative' }, scroll: true,
        columns: [
          { key: 'name', label: 'Initiative', type: 'text', wide: true, placeholder: () => 'e.g. LED retrofit' },
          { key: 'capex', label: 'Capex', type: 'currency', total: true },
          { key: 'savings', label: 'Annual savings', type: 'currency', total: true },
          { key: 'noi', label: 'NOI impact', type: 'currency', total: true },
          { key: 'payback', label: 'Payback (yrs)', type: 'calc', format: 'years', compute: (r) => { const s = num(r.noi) || num(r.savings); return num(r.capex) && s ? num(r.capex) / s : null; } },
        ],
        footer: 'Total' },
    ],
  },
  {
    key: 'proptech', group: 'specialists', title: 'Prop tech', roles: ['proptech'],
    fields: [
      { type: 'info', html: '<p>Mark which applications are deployed at the asset for each core pillar.</p>' },
      { id: 'pillars', type: 'deploy', pillars: [
        { key: 'tenant', name: 'Tenant experience', sub: 'Elevate tenant experience', tiers: [
          ['Smart building ready', ['Wi-Fi', 'Digital signage']],
          ['Automated smart building', ['In-suite tenant control', 'Parking management', 'EV charging', 'Automated emergency communication system', 'Smart waste management', 'Indoor maps & wayfinding', 'Visitor management', 'Washroom consumables data', 'Tenant engagement app', 'Indoor air quality sensors']],
          ['Autonomous ready smart building', ['Singular graphic user interface']]] },
        { key: 'esg', name: 'ESG', sub: 'Progress towards net zero targets', tiers: [
          ['Smart building ready', ['Digital controls (HVAC)', 'Submetering', 'Utility and energy engagement', 'Digital signage']],
          ['Automated smart building', ['Analytics & fault detection (BAS)', 'EV charging', 'Lighting controls', 'Tenant engagement app', 'Analytics & fault detection (elevators, CCTV)', 'Smart waste management', 'Washroom consumables data', 'Indoor air quality sensors']],
          ['Autonomous ready smart building', ['Predictive data']]] },
        { key: 'protection', name: 'Asset protection', sub: 'Asset protection & reduced risk', tiers: [
          ['Smart building ready', ['Digital access controls', 'Digital CCTV', 'Cybersecurity']],
          ['Automated smart building', ['Automatic emergency communication system', 'Analytics & fault detection (BAS)', 'Digital access controls', 'Digital CCTV', 'Analytics & fault detection (elevators, CCTV)']],
          ['Autonomous ready smart building', []]] },
        { key: 'smart', name: 'Smart building', sub: 'Performance & operational efficiency', tiers: [
          ['Smart building ready', ['Base building network (BBN)', 'Digital controls (HVAC)', 'Submetering', 'Utility and energy engagement', 'Cellular DAS', 'Digital CCTV', 'In-suite tenant control', 'Wi-Fi', 'Cybersecurity']],
          ['Automated smart building', ['Automated emergency communication system', 'Analytics & fault detection (BAS)', 'Lighting controls', 'Digital access control', 'EV charging', 'Analytics & fault detection (elevators, CCTV)', 'Indoor maps & wayfinding', 'Touchless elevator control', 'Retail analytics', 'License plate recognition']],
          ['Autonomous ready smart building', ['Predictive data']]] },
      ] },
      { id: 'proptech_recs', type: 'textarea', label: "Top 3 prop tech recommendations for this asset, as they relate to the owner's investment priorities and goals", rows: 5 },
    ],
  },

  // -------------------------------------------------------------- appendix
  {
    key: 'appendix_b', group: 'appendix', title: 'B — Calibration worksheets', roles: ['gm', 'pm', 'apm', 'ops_tech', 'ops_security'],
    fields: [
      { id: 'cal_cleaning', type: 'textarea', label: 'Cleaning contract calibration' },
      { id: 'cal_hvac', type: 'textarea', label: 'HVAC contract calibration' },
      { id: 'cal_elevator', type: 'textarea', label: 'Elevator contract calibration' },
      { id: 'cal_rm', type: 'textarea', label: 'R&M calibration' },
      { id: 'cal_utilities', type: 'textarea', label: 'Utilities calibration' },
      ...[['landscaping', 'Landscaping & grounds calibration', ['Vendor A', 'Vendor B (as applicable)']], ['security', 'Security calibration', ['Guard operations', 'Systems — CCTV & access control']]].map(([id, label, rows]) => ({
        type: 'table', id: 'cal_' + id, label, scroll: true, dynamic: { min: 2, max: 8, addLabel: 'Add line', seed: rows },
        columns: [
          { key: 'name', label: 'Line item', type: 'text', wide: true },
          { key: 'resources', label: 'Current resources / deployment', type: 'textarea' },
          { key: 'cost', label: 'Current cost', type: 'currency', total: true },
          { key: 'recs', label: 'Calibration recommendations', type: 'textarea' },
          { key: 'setup', label: 'Est. initial setup capital cost', type: 'currency', total: true },
          { key: 'ongoing', label: 'Ongoing costs', type: 'currency', total: true },
          { key: 'value', label: 'Est. value enhancement', type: 'text' },
          { key: 'savings', label: 'Est. yearly cost savings', type: 'currency', total: true },
        ],
        footer: 'Total',
      })),
      { id: 'cal_insurance', type: 'textarea', label: 'Insurance cost — analysis & calibration' },
      { id: 'cal_tax', type: 'textarea', label: 'Property tax — analysis & calibration' },
    ],
  },
  {
    key: 'appendix_c', group: 'appendix', title: 'C — Other revenue calculations', roles: ['gm', 'pm', 'apm'],
    fields: [
      { type: 'info', html: '<p>Identify the additional annual NOI that could reasonably be generated from each opportunity. Enter the potential revenue, the incremental costs required to generate it, and the resulting NOI is calculated. Mark N/A where an opportunity does not exist at the asset. Where estimates are used, identify the basis (market comparable, vendor quote, historical experience, etc.).</p>' },
      ...REVENUE_OPPS.map(([key, title, revBasis, costBasis]) => ({ id: key, type: 'revenue', title, revBasis, costBasis })),
      { type: 'calc', label: 'Total annual NOI opportunity — revenue sources', format: 'currency', compute: (ctx) => appendixCTotal(ctx.all), big: true },
      { type: 'calc', label: 'Total NOI opportunity / SF', format: 'currency2', compute: (ctx) => { const t = appendixCTotal(ctx.all); return t !== null && ctx.gla ? t / ctx.gla : null; } },
      { type: 'table', id: 'rev_priority', label: 'Prioritization summary', help: 'Payback = one-time implementation / capital cost ÷ annual NOI opportunity. Annual NOI opportunity should represent incremental stabilized NOI, not gross revenue.',
        dynamic: { min: 5, max: 11, addLabel: 'Add row' }, scroll: true,
        columns: [
          { key: 'name', label: 'Opportunity', type: 'text', wide: true },
          { key: 'noi', label: 'NOI opportunity', type: 'currency' },
          { key: 'cost', label: 'One-time cost', type: 'currency' },
          { key: 'payback', label: 'Payback (yrs)', type: 'calc', format: 'years', compute: (r) => (num(r.cost) && num(r.noi) ? num(r.cost) / num(r.noi) : null) },
          { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY3 },
        ] },
    ],
  },

  // --------------------------------------------------------------- sign-off
  {
    key: 'certification', group: 'signoff', title: 'PM team certification', roles: ALL,
    fields: [
      { type: 'info', html: "<p>We confirm that the information provided in this questionnaire represents our best current understanding of the asset's operating performance, cost structure, tenant environment, risk profile and potential NOI optimization opportunities.</p>" },
      { type: 'table', id: 'signatures', dynamic: { min: 4, max: 10, addLabel: 'Add signatory' },
        columns: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'signature', label: 'Signature (type full name)', type: 'text', signature: true },
          { key: 'date', label: 'Date', type: 'date' },
        ] },
    ],
  },
];

// Readable "answered by" label for each section.
SECTIONS.forEach((s) => {
  s.owner = s.roles === ALL ? 'Everyone' : s.roles.map((r) => ROLE_SHORT[r]).join(', ');
});
export const SECTION_MAP = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

// Is this section meant for someone with these roles?
export function sectionForRoles(section, roles) {
  return section.roles === ALL || (roles || []).some((r) => section.roles.includes(r));
}
export { REVENUE_OPPS, OPEX_LINES };

// Placeholder hints for the NOI register, pulled from calculations elsewhere.
export function registerHint(row, all) {
  if (!row.hint) return null;
  if (row.hint === 'appendix_c') return appendixCTotal(all);
  if (row.hint === 'ptax') return propertyTaxTotal(all);
  if (row.hint === 'energy') return energyTotal(all);
  if (row.hint === 'insurance') return num((all.gm_tax || {}).insurance_savings);
  if (row.hint.startsWith('opex:')) {
    const r = ((all.gm_opex || {}).opex_cal || {})[row.hint.slice(5)];
    return r ? num(r.opportunity) : null;
  }
  return null;
}

// Rough completion measure: share of answerable top-level fields that have something in them.
export function sectionProgress(section, data) {
  if (section.noProgress) return null;
  const fields = section.fields.filter((f) => f.id && f.type !== 'calc');
  if (!fields.length) return null;
  const filled = fields.filter((f) => hasValue(data ? data[f.id] : undefined)).length;
  return filled / fields.length;
}
function hasValue(v) {
  if (v === null || v === undefined || v === '' || v === false) return false;
  if (Array.isArray(v)) return v.some(hasValue);
  if (typeof v === 'object') return Object.entries(v).some(([k, x]) => k !== 'label' && hasValue(x));
  return true;
}
