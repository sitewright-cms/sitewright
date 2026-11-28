// The capture slot's admin, as `scripts/e2e-deploy.sh up` seeds it (SW_E2E_ADMIN_EMAILS / SW_E2E_ADMIN_PASSWORD).
export const ADMIN = { email: process.env.CAPTURE_ADMIN ?? 'lena@northwind.example', password: process.env.CAPTURE_PASSWORD ?? 'Pw-secret-1' };
