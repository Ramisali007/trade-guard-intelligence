/**
 * The two stages of a trade a demo portal can be opened for. A user who signed in for one stage sees
 * only the screens and queues of that stage; with no stage chosen (an institutional sign-in) they see
 * everything their role allows. This only decides what is shown: the API still enforces the role.
 */
export type TradeStage = 'pre' | 'post';

/** Pre-shipment: from the customer's request to the LC being issued. */
const PRE_SCREENS = new Set(['workspace', 'trade-cases', 'new-case', 'post-shipment']);
/** Post-shipment: presented documents onwards, plus the analysis and platform screens. New requests are pre-shipment only. */
const POST_HIDDEN_SCREENS = new Set(['new-case']);

/** Pre-shipment is documents in, scrutiny, messages back: no departmental review or approval queues. */
const PRE_QUEUES = new Set(['to-submit', 'clarifications', 'scrutiny']);
const POST_QUEUES = new Set(['amendments', 'presentations', 'settlement', 'investigations', 'closure']);

/** Navigation links that belong to the pre-shipment stage ('/' is the public overview). */
const PRE_LINKS = new Set(['/workspace', '/trade-cases', '/verification', '/post-shipment', '/']);

/**
 * The stage a role works in, so an institutional sign-in sees exactly what its demo profile sees. The portals are
 * three: the customer and the pre-shipment officer work pre-shipment; the post-shipment officer works post-shipment.
 * Any other role has no stage and keeps every screen and queue its permissions allow.
 */
export function stageForRole(role: string): TradeStage | null {
  switch (role) {
    case 'CORPORATE_CUSTOMER':
    case 'TRADE_MAKER':
      return 'pre';
    case 'POST_TRADE_OFFICER':
      return 'post';
    default:
      return null;
  }
}

export function screenInStage(id: string, stage: TradeStage | null | undefined): boolean {
  if (!stage) return true;
  return stage === 'pre' ? PRE_SCREENS.has(id) : !POST_HIDDEN_SCREENS.has(id);
}

export function queueInStage(id: string, stage: TradeStage | null | undefined): boolean {
  if (!stage) return true;
  return stage === 'pre' ? PRE_QUEUES.has(id) : POST_QUEUES.has(id);
}

export function linkInStage(link: string, stage: TradeStage | null | undefined): boolean {
  if (!stage) return true;
  return stage === 'pre' ? PRE_LINKS.has(link) : link !== '/trade-cases/new';
}
