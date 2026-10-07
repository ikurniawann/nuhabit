// swagger-ui-react tidak menyertakan deklarasi tipe; halaman dokumentasi API memakainya apa adanya.
declare module "swagger-ui-react" {
  import type { ComponentType } from "react";
  const SwaggerUI: ComponentType<{ url?: string; persistAuth?: boolean; deepLinking?: boolean }>;
  export default SwaggerUI;
}
