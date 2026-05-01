import * as fs from 'fs';
import * as path from 'path';

const testFile = 'D:\\AIhub\\mini-agent\\tests\\test.ts';
const testContent = fs.readFileSync(testFile, 'utf-8');

const modules = [
  'agent', 'planner', 'registry', 'monitor', 'config',
  'types', 'output-manager', 'loop-detector', 'skill-registry',
  'skill-loader', 'clawhub-client', 'toolboxes', 'filesystem',
  'exec', 'web', 'skills', 'sandbox'
];

for (const m of modules) {
  const inContent = testContent.includes(m);
  const idx = inContent ? testContent.indexOf(m) : -1;
  const context = inContent ? testContent.substring(Math.max(0, idx-20), idx+30) : '';
  console.log(`${m}: ${inContent ? 'FOUND' : 'not found'} ${inContent ? '...'+context.replace(/\n/g,' ')+'...' : ''}`);
}
