# Invoice Desk

A local business-document web application built with Node.js built-ins and SQLite. Portfolio/demo release; not a certified accounting or tax product.

## Features
Quotations, invoices, receipts, tax invoices, billing notes, cash bills and delivery notes; A4 print/PDF through the browser; customer/report views and configurable branding.

## Run
Requires Node.js 24+ with node:sqlite support. No npm dependencies to install.

    npm start

Open http://127.0.0.1:3000. A new SQLite database and clearly fictional sample invoice are created locally. Existing business data is not included.

## Configuration
PORT defaults to 3000, HOST to 127.0.0.1. DATABASE_PATH sets the SQLite location. Set ADMIN_USER and ADMIN_PASSWORD together; both are required for a non-loopback binding. .env.example documents variable names; the server does not auto-load .env files. Supply environment variables through your shell or process manager.

## Sharing and security scope
Read-only links expose the full invoice to anyone possessing its UUID; public settings are readable for document rendering. Do not enter real customer data in a public demo. Use HTTPS and a reviewed reverse proxy before any hosted deployment. This package is prepared for source publication, not a production-security certification.

## Known limitations
Document numbering currently derives from counts and can repeat after deletion. No tax/regulatory compliance validation is provided. These should be resolved before real business use.

## Verify
Run: node --test tests/server.test.mjs

## Portfolio focus
Document workflow, CRUD APIs, SQLite, branding and print layout. Developed with AI assistance.

## License
MIT — see LICENSE and LICENSE-STATUS.md.
