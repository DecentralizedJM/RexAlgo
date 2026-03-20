# Security

- **API secrets**: Never commit `backend/.env.local` or real Mudrex keys. Use `backend/.env.example` as a template.
- **Production**: Set strong `JWT_SECRET` and `ENCRYPTION_KEY` (see `.env.example` for Docker).
- **Reporting**: Open a private security advisory on GitHub or contact the maintainers through the repository owner.

RexAlgo is **not** affiliated with Mudrex. Trading crypto futures carries significant risk.
