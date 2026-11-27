export interface AuthUser {
  id: number;
  companyId: number;
  branchId: number | null;
  perms: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      customerId?: number;
    }
  }
}
