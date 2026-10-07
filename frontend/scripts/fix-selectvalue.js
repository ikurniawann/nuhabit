#!/usr/bin/env node

const fs = require('fs');

const files = [
  'src/app/(dashboard)/dashboard/staff/page.tsx',
  'src/app/(dashboard)/dashboard/staff/sections/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;
  
  // Pattern 1: <SelectValue>\n{content}\n</SelectValue>
  // Replace with: <SelectValue placeholder={content} />
  const regex1 = /<SelectValue>\s*\n\s*\{([^}]+)\}\s*\n\s*<\/SelectValue>/g;
  const newContent1 = content.replace(regex1, (match, innerContent) => {
    modified = true;
    return `<SelectValue placeholder={${innerContent.trim()}} />`;
  });
  if (modified) content = newContent1;
  
  // Pattern 2: Simple inline <SelectValue>{content}</SelectValue>
  const regex2 = /<SelectValue>\s*\{([^}]+)\}\s*<\/SelectValue>/g;
  const newContent2 = content.replace(regex2, (match, innerContent) => {
    modified = true;
    return `<SelectValue placeholder={${innerContent}} />`;
  });
  if (modified) content = newContent2;
  
  if (modified) {
    fs.writeFileSync(file, content);
    console.log(`Fixed: ${file}`);
  } else {
    console.log(`No changes: ${file}`);
  }
}
