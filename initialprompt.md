Build the first MVP slice for a mobile-first web app called ScopeLock.

Product purpose:
ScopeLock helps independent welders quickly generate short, professional job agreements for small jobs. The goal is to prevent disputes, clarify scope, and protect the welder from being blamed for issues outside their work.

The generated document should be a concise 1–3 page agreement, not a long legal contract.

Target user:
Independent welders, small welding shops, and mobile welders doing repair or fabrication jobs.

Primary workflow:
A welder opens the app on their phone, answers a few quick questions about a job, and generates a simple professional agreement they can send to the client before work begins.

Tech stack:
- Vite
- React
- TypeScript

Constraints:
- mobile-first UI
- no backend required for MVP
- no database
- no authentication
- no Docker
- no complex state libraries
- no AI chat features
- no legal advice features

Use simple React state and modular code.

Architecture requirement:
Create a file at the project root named:

ARCHITECTURE.md

This file must document:

- product purpose
- stack choice
- folder structure
- domain logic vs UI logic
- portability considerations
- how the architecture allows later packaging into iOS using Capacitor
- next planned features

The architecture should emphasize separation between:

- domain logic (agreement generation)
- UI components
- data schemas
- templates

Main feature to build:
Welder Job Agreement Generator

This generator creates a short agreement clarifying:

- scope of work
- responsibilities
- exclusions
- liability boundaries
- completion and responsibility transfer

The agreement should be concise and readable.

The goal is a 1–3 page agreement when printed.

Job types supported initially:

- repair
- fabrication
- mobile repair

Required job input fields:

customer_name
customer_phone
job_location
job_type (repair | fabrication | mobile repair)

asset_or_item_description
requested_work

materials_provided_by (welder | customer | mixed)

installation_included (boolean)
grinding_included (boolean)
paint_or_coating_included (boolean)

removal_or_disassembly_included (boolean)

hidden_damage_possible (boolean)

price_type (fixed | estimate)
price

deposit_required (boolean)

payment_terms

target_completion_date

exclusions[]

assumptions[]

change_order_required (boolean)

workmanship_warranty_days

Document structure to generate:

1. Agreement Header

Include:

Agreement Title
Contractor name
Client name
Job location
Date

2. Project Overview

Short summary describing:

- the item or structure being worked on
- the requested work

3. Scope of Work

Bullet list of what the welder will perform.

Example:
- repair cracked steel bracket
- reinforce joint with weld bead
- grind weld smooth

4. Materials

State whether materials are provided by:

- welder
- client
- mixed

5. Exclusions

Clearly list what is NOT included.

Examples:

- replacement of surrounding components
- structural modifications outside repair area
- painting or finishing unless specified

6. Hidden Damage Clause

If hidden damage is discovered during repair, additional work may require additional approval and cost.

7. Third-Party Work Clause

Contractor is not responsible for work performed by other contractors or modifications made after completion.

8. Change Orders

Any work outside the agreed scope requires client approval and may result in additional charges.

9. Pricing and Payment Terms

Include:

- total price
- estimate vs fixed
- deposit if required
- payment due timing

10. Completion and Responsibility Transfer

After completion and client approval, responsibility for the repaired item transfers back to the client.

The contractor is only responsible for workmanship defects within the warranty period.

11. Workmanship Warranty

Define a simple workmanship warranty such as:

Contractor guarantees the welding workmanship for X days.

Warranty does not cover:

- misuse
- modifications
- unrelated structural failures

12. Client Acknowledgment

Client confirms:

- agreement to scope
- understanding of exclusions
- approval upon completion

Include space for:

Client Name
Client Signature
Date

Implementation instructions:

Create a clean project structure:

src/
components/
data/
lib/
types/

Types:
Define a WelderJob TypeScript interface.

Data:
Include a sample welding job JSON file for testing.

Lib:
Create a pure function that generates the agreement text from job data.

Components:

JobForm
AgreementPreview

The form should:

- be mobile friendly
- support toggles for boolean fields
- allow editing exclusions and assumptions

The preview should render a readable formatted agreement.

Design guidance:

- minimal styling
- readable sections
- bullet lists where appropriate
- optimized for phone screens

Deliverables:

After implementation provide:

1. final file tree
2. full contents of new files
3. minimal diffs for modified files
4. explanation of architecture
5. instructions to run locally

Important rules:

- keep implementation small and clean
- do not invent extra features
- do not add persistence
- do not add PDF export
- do not add signature capture
- do not add file uploads
- do not add AI contract rewriting
- focus only on the generator
