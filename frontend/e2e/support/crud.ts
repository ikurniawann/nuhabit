/** A name no other run or worker shares, so specs never collide on unique columns. */
export const uniqueName = (prefix: string) => `${prefix} E2E ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

