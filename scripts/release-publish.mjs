// Uses the existing Git credential helper; credentials never enter arguments or output.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
const tag = `v${config.version}`;
const repo = 'arushn47/lumaire-music-player';
const base = `https://api.github.com/repos/${repo}`;
const credential = spawnSync('git',['credential','fill'],{ input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'} });
const token = credential.stdout?.match(/^password=(.*)$/m)?.[1];
assert(token,'GitHub credential unavailable.');
async function api(url, options={}) {
  const response = await fetch(url.startsWith('https:')?url:base+url,{...options,headers:{Accept:'application/vnd.github+json','User-Agent':'Lumaire-release','X-GitHub-Api-Version':'2022-11-28',Authorization:`Bearer ${token}`,...options.headers}});
  assert(response.ok,`GitHub request failed (${response.status}) for ${new URL(response.url).pathname}`);
  return response;
}
const [command, arg] = process.argv.slice(2);
if (command === 'status') {
  const metadata=await(await api('')).json();console.log(JSON.stringify({repository:metadata.full_name,defaultBranch:metadata.default_branch}));
  const runs = await (await api('/actions/workflows/windows-release.yml/runs?per_page=5')).json();
  console.log(JSON.stringify(runs.workflow_runs.map(run=>({id:run.id,sha:run.head_sha,branch:run.head_branch,status:run.status,conclusion:run.conclusion,url:run.html_url}))));
  const releases=await(await api('/releases?per_page=8')).json();
  console.log(JSON.stringify(releases.map(release=>({id:release.id,tag:release.tag_name,draft:release.draft,assets:release.assets.map(asset=>asset.name)}))));
} else if (command === 'jobs') {
  assert(/^\d+$/.test(arg));
  const jobs=await(await api(`/actions/runs/${arg}/jobs`)).json();
  console.log(JSON.stringify(jobs.jobs.map(job=>({name:job.name,conclusion:job.conclusion,steps:job.steps.map(step=>({name:step.name,status:step.status,conclusion:step.conclusion}))}))));
} else if (command === 'download') {
  const release=await(await api(`/releases/tags/${tag}`)).json();
  const dir=path.resolve(arg);mkdirSync(dir,{recursive:true});
  for(const asset of release.assets) {
    const response=await api(asset.url,{headers:{Accept:'application/octet-stream'}});
    writeFileSync(path.join(dir,path.basename(asset.name)),Buffer.from(await response.arrayBuffer()));
    console.log(asset.name,asset.size);
  }
} else if (command === 'upload') {
  const release=await(await api(`/releases/tags/${tag}`)).json();
  assert(release.draft,'Only upload into the unpublished draft.');
  const name=path.basename(arg);
  assert(!release.assets.some(asset=>asset.name===name),'Refusing to overwrite an existing release asset.');
  const asset=await(await api(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:readFileSync(arg)})).json();
  console.log(asset.name,asset.size);
} else if (command === 'publish') {
  const release=await(await api(`/releases/tags/${tag}`)).json();
  assert(release.draft,'Expected an unpublished draft.');
  const dir=path.resolve(arg);
  const names=[`Lumaire_${config.version}_x64-setup.exe`,`Lumaire_${config.version}_x64-setup.exe.sig`,`Lumaire-${config.version}-Android-arm64.apk`,'latest.json','SHA256SUMS.txt'];
  for(const name of names) {
    const asset=release.assets.find(asset=>asset.name===name);assert(asset,`Missing ${name}`);
    const local=readFileSync(path.join(dir,name));
    const remote=Buffer.from(await(await api(asset.url,{headers:{Accept:'application/octet-stream'}})).arrayBuffer());
    assert(local.equals(remote),`Uploaded bytes differ: ${name}`);
  }
  const notes=readFileSync('RELEASE_NOTES.md','utf8');
  const manifest=JSON.parse(readFileSync(path.join(dir,'latest.json'),'utf8'));
  assert.equal(manifest.version.replace(/^v/,''),config.version);assert.equal(manifest.notes.trim(),notes.trim());
  const checksums=readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8');
  for(const name of [names[0],names[2]]) assert(checksums.includes(createHash('sha256').update(readFileSync(path.join(dir,name))).digest('hex')+'  '+name));
  const result=await(await api(`/releases/${release.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Lumaire ${tag}`,body:notes,draft:false,prerelease:false,make_latest:'true'})})).json();
  console.log(result.html_url);
} else { throw Error('Use status, jobs ID, download DIR, upload FILE or publish VERIFIED_ASSET_DIR.'); }
