import { extractChangedFacts } from '../lib/pipeline/stage1-diff';
const facts = extractChangedFacts(process.cwd());
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(facts, null, 2));
} else {
  const silent = facts.filter((f) => f.severity === 'silent');
  console.log(`FACTS: ${facts.length}  (silent: ${silent.length}, breaking: ${facts.length - silent.length})`);
  for (const f of facts) {
    console.log(`\n[${f.severity.toUpperCase()}] ${f.id}`);
    console.log(`   ${f.old} -> ${f.new ?? '(removed)'}   src=${f.source} ${f.evidence.file}:${f.evidence.line}`);
    console.log(`   pattern: ${f.pattern.slice(0, 90)}`);
  }
}
