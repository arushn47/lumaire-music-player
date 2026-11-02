import * as std from 'qjs:std';
import * as os from 'qjs:os';
import { backgroundNext } from '../../../src/player/background-policy';
import { loadAutoplayPool } from '../../../src/adapters/autoplay';

globalThis.performance = { now: () => Date.now() };
globalThis.setTimeout = os.setTimeout;
globalThis.clearTimeout = os.clearTimeout;
console.debug = () => {};
function write(value) { std.out.puts(JSON.stringify(value) + '\n'); std.out.flush(); }
globalThis.backgroundRpc = (method, args = {}) => {
  write({ type: 'rpc', method, args });
  const raw = std.in.getline();
  if (raw === null || raw.length > 20 * 1024 * 1024) throw Error('Background transport disconnected.');
  const reply = JSON.parse(raw);
  if (!reply.ok) throw Error(reply.error || 'Background operation failed.');
  return reply.value;
};
globalThis.crypto = { randomUUID: () => backgroundRpc('uuid') };
const call = async (method, args) => backgroundRpc(method, args);
try {
  const input = JSON.parse(std.in.getline());
  const library = {
    select: entryId => write({ type: 'selection', entryId }),
    lookup: id => call('lookup', { id }),
    autoplayPool: anchor => loadAutoplayPool(anchor, () => true, 0),
    search: (query, maxResults) => call('search', { query, maxResults }),
    resolve: id => call('resolve', { id }),
    verified: id => call('verified', { id }),
    remember: (id, source) => call('remember', { id, source }),
  };
  const result = await backgroundNext(input.queue, library, input.direction, input.ended);
  write({ type: 'result', value: result });
} catch (error) {
  const message = String(error?.message || 'The next recording could not be prepared.').replace(/https?:\/\/\S+/g, '[source]').slice(0, 500);
  write({ type: 'error', error: message });
}
