"use client";

import { useSyncExternalStore } from "react";

import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, FONT_STACKS } from "@/lib/theme/appearance-tokens";
import { THEME_STORAGE_KEY } from "@/lib/theme/theme-state";

/** Blocking anti-flash script. Keep in sync with appearance tokens + pickForeground. */
const SCRIPT = `(function(){try{
var root=document.documentElement;
var raw=localStorage.getItem('${THEME_STORAGE_KEY}');
var s=raw?JSON.parse(raw):null;
var mode=s&&['light','dark','auto'].indexOf(s.mode)>=0?s.mode:'light';
root.setAttribute('data-theme',mode);
function lum(hex){hex=String(hex).replace('#','');if(hex.length===3)hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];var r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;function c(v){return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}r=c(r);g=c(g);b=c(b);return 0.2126*r+0.7152*g+0.0722*b}
function ratio(a,b){var L1=lum(a),L2=lum(b);var hi=Math.max(L1,L2),lo=Math.min(L1,L2);return(hi+0.05)/(lo+0.05)}
function fgOf(p){if(ratio('#ffffff',p)>=ratio('#000000',p))return '#ffffff';return ratio('#00281a',p)>=4.5?'#00281a':'#000000'}
var a=null;
try{a=JSON.parse(localStorage.getItem('${APPEARANCE_STORAGE_KEY}')||'null')}catch(e){}
var b=${JSON.stringify(DEFAULT_APPEARANCE.base)};
var sb=${JSON.stringify(DEFAULT_APPEARANCE.sidebar)};
var nb=${JSON.stringify(DEFAULT_APPEARANCE.navbar)};
var p=b.primary;
var sec=b.secondary;
var ft=a&&a.font?a.font:{};
var fam=${JSON.stringify(FONT_STACKS.manrope)};
var size=(ft.size===14||ft.size===15||ft.size===16)?ft.size:16;
root.style.setProperty('--brand-primary',p);
root.style.setProperty('--brand-secondary',sec);
root.style.setProperty('--primary-foreground',fgOf(p));
root.style.setProperty('--background',b.background);
root.style.setProperty('--foreground',b.foreground);
root.style.setProperty('--card',b.card);
root.style.setProperty('--card-foreground',b.foreground);
root.style.setProperty('--destructive',b.destructive);
root.style.setProperty('--border',b.border);
root.style.setProperty('--input',b.input);
root.style.setProperty('--ring',b.ring);
root.style.setProperty('--sidebar-background',sb.background);
root.style.setProperty('--sidebar-foreground',sb.foreground);
root.style.setProperty('--sidebar-active-background',sb.activeBackground);
root.style.setProperty('--sidebar-active-foreground',sb.activeForeground);
root.style.setProperty('--sidebar-border',sb.border);
root.style.setProperty('--navbar-background',nb.background);
root.style.setProperty('--navbar-foreground',nb.foreground);
root.style.setProperty('--navbar-border',nb.border);
root.style.setProperty('--font-sans-stack',fam);
root.style.setProperty('--font-size-base',size+'px');
}catch(e){}})();`;

const subscribe = () => () => {};

/**
 * Emit the anti-flash <script> only during SSR + hydration.
 * After hydration, render null so React 19 does not warn about creating
 * a script tag during a client render (scripts would not re-execute anyway).
 */
export function ThemeScript() {
  const isServerOrHydration = useSyncExternalStore(
    subscribe,
    () => false,
    () => true
  );

  if (!isServerOrHydration) return null;

  return (
    <script
      id="arkiv-theme-init"
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
