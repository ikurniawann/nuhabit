/**
 * Bingkai portal lama (/member/classic, /member/nox). Kelas `member-portal`
 * membawa token warna yang diturunkan dari brand (--brand-primary).
 * max-w-lg (512px) supaya HP lebar tetap terisi penuh.
 */
export function LegacyMemberShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="member-portal member-portal-bg min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-3 pb-8 pt-5 sm:px-4">
        {children}
      </div>
    </div>
  );
}
