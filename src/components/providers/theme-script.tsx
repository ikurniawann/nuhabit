"use client";

import { useSyncExternalStore } from "react";

import { APPEARANCE_STORAGE_KEY, FONT_STACKS } from "@/lib/theme/appearance-tokens";
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
function fgOf(p){return ratio('#ffffff',p)>=ratio('#000000',p)?'#ffffff':'#000000'}
var fonts=${JSON.stringify(FONT_STACKS)};
var a=null;
try{a=JSON.parse(localStorage.getItem('${APPEARANCE_STORAGE_KEY}')||'null')}catch(e){}
var presets={wonderland:['#1d1dcc','#2941d3'],ocean:['#0ea5e9','#6366f1'],emerald:['#10b981','#14b8a6'],graphite:['#334155','#64748b'],sunset:['#f97316','#ef4444']};
var preset=(s&&typeof s.presetId==='string'&&presets[s.presetId])?presets[s.presetId]:presets.wonderland;
var b=a&&a.base?a.base:{};
var p=(typeof b.primary==='string')?b.primary:((s&&typeof s.customPrimary==='string')?s.customPrimary:preset[0]);
var sec=(typeof b.secondary==='string')?b.secondary:((s&&typeof s.customSecondary==='string')?s.customSecondary:preset[1]);
var sb=a&&a.sidebar?a.sidebar:{};
var nb=a&&a.navbar?a.navbar:{};
var ft=a&&a.font?a.font:{};
var fam=fonts[ft.family]||fonts.roundo;
var size=(ft.size===14||ft.size===15||ft.size===16)?ft.size:16;
root.style.setProperty('--brand-primary',p);
root.style.setProperty('--brand-secondary',sec);
root.style.setProperty('--primary-foreground',fgOf(p));
root.style.setProperty('--background',b.background||'#ffffff');
root.style.setProperty('--foreground',b.foreground||'#0f172a');
root.style.setProperty('--card',b.card||'#ffffff');
root.style.setProperty('--card-foreground',b.foreground||'#0f172a');
root.style.setProperty('--destructive',b.destructive||'#dc2626');
root.style.setProperty('--border',b.border||'#e5e7eb');
root.style.setProperty('--input',b.input||'#d1d5db');
root.style.setProperty('--ring',b.ring||p);
root.style.setProperty('--sidebar-background',sb.background||'#f4f6fe');
root.style.setProperty('--sidebar-foreground',sb.foreground||'#0f172a');
root.style.setProperty('--sidebar-active-background',sb.activeBackground||p);
root.style.setProperty('--sidebar-active-foreground',sb.activeForeground||fgOf(sb.activeBackground||p));
root.style.setProperty('--sidebar-border',sb.border||'#e2eafd');
root.style.setProperty('--navbar-background',nb.background||'#ffffff');
root.style.setProperty('--navbar-foreground',nb.foreground||'#0f172a');
root.style.setProperty('--navbar-border',nb.border||'#f3f4f6');
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
