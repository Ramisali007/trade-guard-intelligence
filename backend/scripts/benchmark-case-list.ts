/**
 * How long the case list and the dashboard queues take with many cases in the store.
 *
 *   npm run bench:cases -- [--cases 1000] [--fixture <backup.json>]
 *
 * Runs against the in-memory store in a throwaway process; nothing on disk or in MongoDB is touched. Each case is a copy
 * of a real, fully processed case when `--fixture` points to a backup that holds `collections.trade_cases` (the fresh-start
 * and demo-reset backups do); otherwise a synthetic one of similar size is built from a case created through the service.
 * Prints the median and worst time of the three list calls the screens make, and how long the event loop was blocked.
 */
import '../src/__tests__/test-env';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createApp } from '../src/app';
import { ComplianceStore } from '../src/compliance/db/compliance-store';
import { signBankingToken } from '../src/middleware/auth.middleware';
import { findDemoAccount, initAccountDirectory, type DemoAccountKey } from '../src/services/account-directory';
import { CustomerRepository } from '../src/services/customer.repository';
import { initRepository } from '../src/services/document.repository';
import { getTradeCaseRepository, initTradeCaseRepository } from '../src/trade-cases/trade-case.repository';
import type { TradeCase } from '../src/trade-cases/trade-case.types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fixtureCase(): TradeCase {
  const file = arg('fixture');
  if (!file) throw new Error('Pass --fixture <backup.json> (a fresh-start or demo-reset backup that contains trade_cases).');
  const backup = JSON.parse(fs.readFileSync(file, 'utf8')) as { collections?: { trade_cases?: TradeCase[] } };
  const biggest = [...(backup.collections?.trade_cases ?? [])].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  if (!biggest) throw new Error('The backup holds no trade cases.');
  return biggest;
}

async function main(): Promise<void> {
  const count = Number(arg('cases') ?? 1000);
  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  await initAccountDirectory();

  const template = fixtureCase();
  const repo = getTradeCaseRepository();
  const customers = ['TG-CORP-1001', 'TG-CORP-1002'];
  for (let i = 0; i < count; i++) {
    const c = structuredClone(template);
    c.caseId = `BENCH-${i}`;
    c.customerRef = customers[i % customers.length]!;
    c.revision = 1;
    c.status = 'UNDER_REVIEW';
    delete (c as { clientRequestId?: string }).clientRequestId;
    await repo.create(c);
  }
  console.log(`${count} cases of ${(JSON.stringify(template).length / 1024).toFixed(0)} KB each in the store`);

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const as = (key: DemoAccountKey) => ({ authorization: `Bearer ${signBankingToken(findDemoAccount(key)!, 1)}` });

  const calls: Array<[string, string, DemoAccountKey]> = [
    ['staff  GET /trade-cases', '/trade-cases', 'trade_maker'],
    ['staff  GET /workspace', '/workspace', 'trade_maker'],
    ['staff  GET /workspace/history', '/workspace/history', 'trade_maker'],
    ['customer GET /trade-cases', '/trade-cases', 'corporate_customer'],
  ];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  for (const [label, path, who] of calls) {
    const times: number[] = [];
    loop.reset();
    loop.enable();
    for (let n = 0; n < 5; n++) {
      const t = performance.now();
      const res = await fetch(base + path, { headers: as(who) });
      await res.arrayBuffer();
      if (res.status !== 200) throw new Error(`${label}: HTTP ${res.status}`);
      times.push(performance.now() - t);
    }
    loop.disable();
    times.sort((a, b) => a - b);
    console.log(`${label.padEnd(30)} median ${times[2]!.toFixed(0).padStart(6)} ms   worst ${times[4]!.toFixed(0).padStart(6)} ms   event loop stalled up to ${(loop.max / 1e6).toFixed(0)} ms`);
  }
  server.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
