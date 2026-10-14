import { TrainingSubnav } from "@/features/site/components/training-subnav";

export default function TrainingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <TrainingSubnav />
      {children}
    </>
  );
}
