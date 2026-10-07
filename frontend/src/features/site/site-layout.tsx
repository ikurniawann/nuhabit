import type { ReactNode } from "react";
import Script from "next/script";
import { cookies } from "next/headers";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-portal/session";
import { fetchBranches, fetchContent } from "./lib/public-api";
import { SiteShell } from "./shell/site-shell";

const GTM_ID = /^GTM-[A-Z0-9]+$/;
const PIXEL_ID = /^\d{5,20}$/;

/**
 * Server half of the public shell: loads the branches, social links and
 * analytics ids, reads whether a member session cookie exists (a link
 * only; the member area validates it) and hands the rest to SiteShell.
 */
export async function SiteLayout({ children }: { children: ReactNode }) {
  const [branches, social, analytics, cookieStore] = await Promise.all([
    fetchBranches(),
    fetchContent("social"),
    fetchContent("analytics"),
    cookies(),
  ]);
  const memberLinked = Boolean(cookieStore.get(MEMBER_SESSION_COOKIE)?.value);
  const gtm = GTM_ID.test(analytics.gtm_id) ? analytics.gtm_id : "";
  const pixel = PIXEL_ID.test(analytics.meta_pixel_id) ? analytics.meta_pixel_id : "";

  return (
    <>
      {gtm ? (
        <Script id="gtm" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
        </Script>
      ) : null}
      {pixel ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixel}');fbq('track','PageView');`}
        </Script>
      ) : null}
      <SiteShell branches={branches} social={social} memberLinked={memberLinked}>
        {children}
      </SiteShell>
    </>
  );
}
