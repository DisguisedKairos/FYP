# Green Link Digital Bank branding

This Republic Polytechnic C300 FYP is a business banking prototype based on **Green Link Digital Bank (GLDB)**. The official bank name uses the words “Green Link”. The UI uses GLDB where navigation space is limited.

## Asset sources

Retrieved on 24 October 2026 from the bank's [official website](https://www.glbank.com/):

| Local asset | Source / treatment |
| --- | --- |
| `public/brand/gldb-logo.svg` | Official full-colour inline header SVG from the homepage; original path geometry and colours retained |
| `public/brand/gldb-logo-white.svg` | [Official white logo](https://www.glbank.com/static/gldb-logo-white.svg), retained for dark surfaces |
| `public/favicon.svg` | Official orange G monogram path placed on a blue square for the browser tab |
| UI colours | Official homepage CSS variables: blue `#003C82`, orange `#F08200`; lighter/darker supporting colours are project styling |

The bank's logo and identity belong to their respective owner. They identify the company studied by this educational project; the application is a student prototype. The login, application footer and printed statements identify the project and sample funds.

Logos are served locally, so signing in, account pages, statements and the assistant do not contact the bank or an external asset host. Browser security policy remains restricted to local application resources. No bank login page, real customer data, banking credentials or external payment connection is included.

## Application coverage

The official identity appears on the loading screen, sign-in/registration, navigation, browser tab and printed/PDF account statements. Page titles, the assistant name, account/payment descriptions and new authenticator enrolment labels use the company identity. Company legal names appear as account holders, with human operators shown separately.

The implemented scope stays with business savings, balances, internal transfers, simulated business bills, schedules, history/statements, authorization and fraud controls. The real bank also advertises financing products; those are not presented as working features in this prototype.

Existing demo email addresses/passwords, PostgreSQL database/role names, application URLs, request keys and encryption bindings remain stable. Existing authenticator codes keep working; only newly generated enrolment labels use the corrected bank name. Earlier historical source snapshots retain their original identity text for migration reference.
