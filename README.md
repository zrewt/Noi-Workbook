# NOI Optimization Workbook — website

An online version of the *NOI Optimization Workbook* questionnaire. Site teams sign in, answer
their sections, and everything saves automatically to Supabase. A running "NOI opportunity
identified" total updates as the calculation tables are filled in.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The page. Open this to use the site. |
| `config.js` | **The only file you need to edit** — your Supabase URL and key go here. |
| `questionnaire.js` | Every question, table and calculation from the Word document. Edit this to change wording or add questions. |
| `app.js`, `db.js`, `styles.css` | How the site works and looks. |
| `supabase/schema.sql` | Creates the database tables, security rules and photo storage. Safe to run again after updates. |

## Try it first (no setup)

Leave `config.js` blank and the site runs in **demo mode** — data stays in your browser only.
To open it, the files need to be served (double-clicking `index.html` won't load the scripts). Easiest ways:

- **VS Code:** install the "Live Server" extension, right-click `index.html` → *Open with Live Server*.
- **Python:** in this folder run `python -m http.server 8000`, then open http://localhost:8000

## Go live with Supabase (about 10 minutes)

1. **Create a project** at https://supabase.com (free tier is fine).
2. **Create the database:** in your project go to **SQL Editor → New query**, paste everything from
   `supabase/schema.sql`, and click **Run**. It should finish with "Success".
3. **Connect the site:** go to **Project Settings → API** (or **Connect**) and copy the
   **Project URL** and the **anon / publishable key**. Paste them into `config.js`:
   ```js
   SUPABASE_URL: 'https://abcdefgh.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   ```
   The anon key is meant to be public — the database security rules protect the data.
   Never put the `service_role` / secret key in the website.
4. **Put the site online.** Any static host works. Simplest: drag this whole folder onto
   https://app.netlify.com/drop — you'll get a URL like `https://noi-workbook.netlify.app`.
   (Vercel, Cloudflare Pages or GitHub Pages also work.)
5. **Tell Supabase your site's address:** **Authentication → URL Configuration**
   - *Site URL*: your site's URL (e.g. `https://noi-workbook.netlify.app`)
   - *Redirect URLs*: add the same URL. Add `http://localhost:8000` too if you test locally.
   This is what makes the "confirm your email" and "reset password" links work.
6. **Keep email confirmation on** (Authentication → Sign In / Providers → Email → *Confirm email*).
   Access is granted by email address, so people must prove they own the email they sign up with.
7. **Make yourself admin:** sign up on the site, then run this in the SQL Editor with your email:
   ```sql
   update public.profiles set is_admin = true where email = 'you@company.com';
   ```
   Admins can see, edit and review every workbook.

> Supabase's built-in email sender is limited to a few emails per hour. Before inviting a whole
> team, set up your own SMTP under **Authentication → Emails → SMTP Settings** (e.g. via Resend or SendGrid).

## How people use it

1. **Create a workbook** for a property (button on the home page). You become its *owner*.
2. Open **Team & status** and **add the site team by email** — GM, PM, APM, operations,
   accounting, sustainability, prop tech, lease admin.
   - *Editor* — answers the sections for their role
   - *Viewer* — read only
   - *Owner* — can answer any section, add people, reopen and delete the workbook
3. Each person **creates an account with that same email** and **picks their role** (they can pick
   more than one). The workbook appears on their home page showing **only the sections for their role**.
   Anyone who signed up without a role is asked for one the next time they sign in, and people can
   change their role under *Account*.
   - The database enforces this too: people can only save answers in their own role's sections.
     They can still *read* other sections (calculations like $/SF need the GLA from the PM's section).
   - Workbook **owners and admins** can switch between *My sections* and *All sections* and can edit any section.
   - The **Team & status** page shows each person's role and flags sections that no one on the team covers yet.
4. Answers **save automatically** a moment after typing. Each section is saved separately, so
   different people can work on different sections at the same time. (If two people edit the
   *same* section at once, the last save wins.)
5. When done, anyone with edit access clicks **Submit for review** — answers lock. Admins can
   **Mark as reviewed**; owners can **Reopen for editing**.
6. **Download answers** as CSV (opens in Excel) or JSON from Team & status.

## Calculations built in

- $/SF figures use the GLA entered in *Site team & asset information*.
- Benchmark average, over/under benchmark, payback periods and table totals.
- Prioritization matrix: score /20 and the weighted score
  (40% NOI impact, 20% ease, 15% risk, 15% tenant value, 10% strategic → /100) with P1–P4 bands.
- Appendix C: C = A − B, E = C − D, G = E ÷ SF and payback for each revenue opportunity.
- Energy: potential NOI = current cost × achievable reduction %.
- The NOI register shows calculated values from the other tables as grey hints to confirm.
- The PM submission summary totals the register and the matrix investments.

## Where the data lives (Supabase tables)

- `questionnaires` — one row per property workbook
- `questionnaire_members` — who has access (by email) and their role
- `responses` — the answers, one row per workbook section (JSON in the `data` column),
  with who saved it and when
- `profiles` — name, title and admin flag for each user
- Storage bucket `site-photos` — uploaded site and lobby photos (private)

## Which role answers which section

| Role | Sections |
|---|---|
| Account Lead / Director | Owner investment priorities, Leasing & market conditions |
| Leasing | Leasing & market conditions |
| Accounting — Controller / Manager | Accounting |
| GM, PM, APM | Site team & asset info, SWOT & technical, Operating costs & contracts, Insurance & property tax, Other revenue, Data & KPIs, Tenant engagement, Appendix B & C |
| GM, PM only | Prioritization & NOI register, PM submission summary |
| Operations — Technical | SWOT & technical priorities, Risk & capital projects, Appendix B |
| Operations — Security | Risk & capital projects, Appendix B |
| Lease Administration | Lease administration |
| Sustainability Lead | Sustainability |
| Prop Tech Lead | Prop tech |
| Everyone | How this works, PM team certification |

To change this, edit the `roles: [...]` list on a section in `questionnaire.js` **and** the matching
rows in the `section_roles` insert in `supabase/schema.sql`, then re-run the schema.

## Editing the questions

All questions live in `questionnaire.js`. Each section is a block like:
```js
{ id: 'market', type: 'textarea', label: 'What are current conditions in the market for this site?' },
```
Field types: `text`, `textarea`, `number`, `currency`, `percent`, `date`, `select`, `radio`,
`yesno`, `checks`, `slider`, `rank`, `photos`, `table`. Changing a label is safe. Changing an
`id` disconnects any answers already saved under the old id.
