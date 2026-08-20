# Bewlet account setup

The repository now contains the public homepage and the first registration schema. No secret values are committed.

## 1. Create Supabase project

1. Create a Supabase project.
2. Open the SQL editor and run `supabase_schema.sql`.
3. In Authentication → Providers → Google, enable Google after completing step 2 below.
4. Copy the project URL and publishable key. Never use the secret/service key in browser code.

## 2. Configure Google login

1. Create a Google Cloud project.
2. Configure the Google Auth Platform branding and audience.
3. Create a Web application OAuth client.
4. Add these authorized origins:
   - `https://bewlet.vercel.app`
   - your local development origin, if needed
5. Add the Supabase callback URL shown on the Supabase Google provider page as an authorized redirect URI.
6. Paste the Google client ID and client secret into the Supabase Google provider settings.

Registration initially requests identity scopes only. Google Drive/Sheets authorization will be added as a separate step after the owner approves an account.

## 3. Configure Vercel

Add these project environment variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server-only; never expose through `public-config.js`)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only legacy JWT used for PostgREST/Auth admin operations)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ADMIN_EMAIL`

Redeploy after adding the variables.

Also configure:

- `APP_ORIGIN` (`https://bewlet.vercel.app` in production)
- `TOKEN_ENCRYPTION_KEY` (a randomly generated secret of at least 32 characters)
- `FEEDBACK_APPS_SCRIPT_URL` (the owner-only feedback endpoint)
- `RESEND_API_KEY` and `APP_FROM_EMAIL` (optional registration and approval email notifications)
- `APPROVAL_TIME_TEXT` and the `PAYMENT_ID_*` / `PAYMENT_INTL_*` variables from `.env.example` (public payment instructions shown during registration)

## 4. Bootstrap the owner account

1. Sign in once through the new homepage so an Auth user is created.
2. Run this once in the Supabase SQL editor, replacing the email:

```sql
insert into private.admin_users (user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
on conflict (user_id) do nothing;

update public.profiles
set status = 'approved', license_type = 'lifetime', approved_at = now()
where email = 'YOUR_ADMIN_EMAIL';
```

## Routes

- `/` — public homepage and Google registration (`index.html`)
- `/app?mode=demo` — isolated demo; never persists changes or syncs finance data
- `/app` — finance application served from `app.html` (route enforcement is added with the approval backend phase)

## Private Google Sheet synchronization

In the same Google Cloud project, enable the Google Sheets API and Google Drive API. Add this exact OAuth redirect URI to the Web application client:

- `https://bewlet.vercel.app/api/google-oauth`

Bewlet requests `drive.file`, not unrestricted Drive access. It can create and manage its own spreadsheet and backup JSON files, while unrelated Drive files remain outside its access.

Run the complete current `supabase_schema.sql` again. It is idempotent and adds encrypted Google-connection storage, backup metadata, admin approval functions, and registration-notification tracking.

`TOKEN_ENCRYPTION_KEY` must remain stable. Changing it invalidates stored Google refresh tokens and requires users to reconnect Drive.

## Account and data lifecycle

1. A new Gmail user signs in and receives `pending` status.
2. The owner receives an optional email notification and reviews the account in Settings.
   The same controls are also available on the dedicated `/admin` page. An administrator is offered a choice between Bewlet and Admin Control after sign-in.
3. After approval, the user signs in and connects Google Drive.
4. Bewlet creates `Bewlet Finance Data` in that user’s Drive.
5. Transactions, settings, lists, budgets, goals, and navigation preferences synchronize with revision conflict checks.
6. Before replacing non-empty cloud data, Bewlet creates at most one automatic backup per day.
7. Users can create manual backups, restore, download a complete JSON export, or permanently delete their account.

Before public sales, complete Google OAuth verification and test approval, rejection, token refresh, offline edits, conflicts, restore, export, and deletion with non-owner accounts.

## Next implementation phase

- Private payment-proof upload UI
- Atomic founder-license allocation tied to verified payment
