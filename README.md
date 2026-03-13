# ScopeLock

**Simple Agreements for Welders**

ScopeLock helps independent welders quickly generate short, professional job agreements for small jobs. The goal is to prevent disputes, clarify scope, and protect the welder from being blamed for issues outside their work.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Features

- ✅ Mobile-first responsive design
- ✅ Welder Job Agreement Generator
- ✅ Real-time agreement preview
- ✅ Copy to clipboard functionality
- ✅ Print/PDF export support
- ✅ No backend required
- ✅ No authentication needed
- ✅ No database required

## Tech Stack

- **Vite** - Fast build tool and dev server
- **React** - UI framework
- **TypeScript** - Type safety

## Project Structure

```
scope-lock/
├── src/
│   ├── components/
│   │   ├── JobForm.tsx              # Main job input form
│   │   └── AgreementPreview.tsx     # Agreement preview component
│   ├── data/
│   │   └── sample-job.json          # Sample job data for testing
│   ├── lib/
│   │   └── agreement-generator.ts   # Domain logic for agreement generation
│   ├── types/
│   │   └── index.ts                 # TypeScript type definitions
│   ├── App.tsx                      # Main app component
│   ├── App.css                      # Mobile-first styles
│   └── main.tsx                     # Entry point
├── ARCHITECTURE.md                  # Architecture documentation
├── package.json
└── README.md
```

## How to Use

1. Open the app on your phone or desktop
2. Fill in the job details form:
   - Customer information
   - Job type and description
   - Materials and services included
   - Pricing and payment terms
   - Exclusions and assumptions
   - Warranty period
3. Switch to "Agreement Preview" tab to see the generated agreement
4. Copy the text or print/PDF the document
5. Send to your client before starting work

## Agreement Sections Generated

1. Agreement Header (date, parties, location)
2. Project Overview
3. Scope of Work
4. Materials
5. Exclusions
6. Hidden Damage Clause (if applicable)
7. Third-Party Work Clause
8. Change Orders (if enabled)
9. Pricing and Payment Terms
10. Completion and Responsibility Transfer
11. Workmanship Warranty
12. Client Acknowledgment

## Deployment

The app can be deployed to any static hosting platform:

- **Vercel**: `vercel deploy`
- **Netlify**: Connect GitHub repo or drag-and-drop `dist/` folder
- **GitHub Pages**: Push to `gh-pages` branch
- **Cloudflare Pages**: Connect GitHub repo
- **AWS S3 + CloudFront**: Upload `dist/` contents to S3 bucket

Build command: `npm run build`
Output directory: `dist/`

## Future Roadmap

### Phase 2 (Next)
- [ ] PDF export
- [ ] Signature capture (canvas)
- [ ] Local storage persistence
- [ ] Share via SMS/email

### Phase 3
- [ ] Multiple templates
- [ ] Custom branding (logo, colors)
- [ ] Job history
- [ ] Client database

### Phase 4 (Capacitor)
- [ ] iOS app packaging
- [ ] Android app packaging
- [ ] Native file sharing
- [ ] Camera integration

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation on:
- Product purpose
- Stack choices
- Folder structure
- Domain logic vs UI logic
- Portability considerations
- Capacitor packaging path

## Development Guidelines

- Mobile-first CSS (start with mobile, add desktop styles)
- Pure functions for business logic
- No external state management (React state only)
- TypeScript for all code
- Keep components small and focused

## License

MIT

## Support

For questions or issues, please open an issue on GitHub.
