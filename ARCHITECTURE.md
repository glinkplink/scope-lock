# ScopeLock Architecture

## Product Purpose

ScopeLock helps independent welders quickly generate short, professional job agreements for small jobs. The goal is to prevent disputes, clarify scope, and protect the welder from being blamed for issues outside their work.

The generated document is a concise 1–3 page agreement, not a long legal contract.

### Target Users
- Independent welders
- Small welding shops
- Mobile welders doing repair or fabrication jobs

### Primary Workflow
A welder opens the app on their phone, answers a few quick questions about a job, and generates a simple professional agreement they can send to the client before work begins.

## Tech Stack

- **Vite**: Fast build tool and dev server
- **React**: UI framework
- **TypeScript**: Type safety and better DX

### Why This Stack?
- Zero backend required for MVP
- Fast development and hot reload
- Easy to deploy statically
- Can be packaged into iOS/Android apps later using Capacitor
- No complex state management needed for MVP scope

## Folder Structure

```
scope-lock/
├── src/
│   ├── components/       # UI components
│   │   ├── JobForm.tsx
│   │   └── AgreementPreview.tsx
│   ├── data/             # Sample data and constants
│   │   └── sample-job.json
│   ├── lib/              # Domain logic (pure functions)
│   │   └── agreement-generator.ts
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts
│   ├── App.tsx           # Main app component
│   └── main.tsx          # Entry point
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── ARCHITECTURE.md
```

## Domain Logic vs UI Logic

### Domain Logic (`src/lib/`)
- Pure functions with no side effects
- Agreement text generation from job data
- No React dependencies
- Testable in isolation
- File: `agreement-generator.ts`

### UI Logic (`src/components/`)
- React components for user interaction
- Form state management
- Rendering agreement preview
- Mobile-first responsive design
- Files: `JobForm.tsx`, `AgreementPreview.tsx`

### Type Definitions (`src/types/`)
- Shared TypeScript interfaces
- Single source of truth for data shapes
- File: `index.ts`

### Data (`src/data/`)
- Sample job data for testing
- Constants and templates
- File: `sample-job.json`

## Separation of Concerns

The architecture emphasizes clear separation between:

1. **Domain Logic (Agreement Generation)**
   - Located in `src/lib/agreement-generator.ts`
   - Pure function: `generateAgreement(job: WelderJob): string`
   - No UI dependencies
   - Easy to test and reuse

2. **UI Components**
   - Located in `src/components/`
   - Handle user input and display
   - Use React state for form management
   - Import domain logic but not vice versa

3. **Data Schemas**
   - Located in `src/types/index.ts`
   - Define `WelderJob` interface
   - Used by both domain logic and UI

4. **Templates**
   - Embedded in domain logic as template strings
   - Structured for easy customization
   - Separated by document sections

## Portability Considerations

### Current (Web MVP)
- Runs in browser
- No persistence
- No backend dependencies
- Static hosting compatible

### Future (Capacitor iOS/Android)
- Can be wrapped with Capacitor
- No code changes needed for basic functionality
- Add native features later:
  - File system access for saving agreements
  - Camera for signature capture
  - Share sheet for sending documents
- React components are already mobile-first

### Migration Path to Capacitor
1. Install Capacitor: `npm install @capacitor/core @capacitor/cli`
2. Initialize: `npx cap init`
3. Add platforms: `npx cap add ios`
4. Wrap existing React app (no major refactoring)
5. Add native plugins as needed

## Next Planned Features

### MVP (Current)
- [x] Job input form
- [x] Agreement text generation
- [x] Agreement preview
- [x] Mobile-first UI

### Phase 2
- [ ] PDF export
- [ ] Signature capture (canvas)
- [ ] Local storage persistence
- [ ] Copy to clipboard
- [ ] Share via SMS/email

### Phase 3
- [ ] Multiple templates
- [ ] Custom branding (logo, colors)
- [ ] Job history
- [ ] Client database
- [ ] Cloud sync

### Phase 4 (Capacitor)
- [ ] iOS app packaging
- [ ] Android app packaging
- [ ] Native file sharing
- [ ] Offline support
- [ ] Camera integration

## Design Principles

1. **Mobile-First**: Optimized for phone screens, touch-friendly
2. **Minimal**: No unnecessary features or complexity
3. **Fast**: Quick to load, quick to complete a job
4. **Clear**: Readable agreements, simple language
5. **Portable**: Easy to deploy, easy to package

## Development Guidelines

- Use TypeScript for all new code
- Keep components small and focused
- Prefer pure functions for business logic
- No external state management libraries (React state is enough)
- Mobile-first CSS (start with mobile, add desktop styles)
- No backend for MVP
- No authentication for MVP
- No database for MVP

## Running the Application

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

The app can be deployed to any static hosting:
- Vercel
- Netlify
- GitHub Pages
- Cloudflare Pages
- AWS S3 + CloudFront

Build command: `npm run build`
Output directory: `dist/`
