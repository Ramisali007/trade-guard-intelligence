import { describeKpiOnHover, kpiTitle } from './kpi-tooltip';

/** Hovering a headline box shows what it is, from what it shows; a tooltip written for a box is never overwritten. */
describe('KPI tooltips', () => {
  const make = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
  };
  afterEach(() => document.body.replaceChildren());

  it('reads a tile as "label: value — note"', () => {
    const tile = make('<div class="kpi-tile"><span class="kpi-tile-label">Pending work</span><strong class="kpi-tile-value"> 3 </strong><span class="kpi-tile-note">cases that need your action</span></div>');
    expect(kpiTitle(tile)).toBe('Pending work: 3 — cases that need your action');
  });

  it('reads a tile with no note, and a card of the older style', () => {
    expect(kpiTitle(make('<div class="kpi-tile"><span class="kpi-tile-label">Queues</span><strong class="kpi-tile-value">2</strong></div>'))).toBe('Queues: 2');
    expect(kpiTitle(make('<div class="kpi-card"><span class="kpi-title">Documents</span><span class="kpi-value">14</span><span class="kpi-sub">analyzed today</span></div>'))).toBe('Documents: 14 — analyzed today');
  });

  it('falls back to the box\'s own text when it has no recognisable parts', () => {
    expect(kpiTitle(make('<div class="adm-kpi">Accounts   <b>12</b> active</div>'))).toBe('Accounts 12 active');
  });

  it('sets the tooltip on hover, from any element inside the box, and refreshes it when the number changes', () => {
    const tile = make('<div class="kpi-tile"><span class="kpi-tile-label">Cases</span><strong class="kpi-tile-value"><em>1</em></strong></div>');
    describeKpiOnHover(tile.querySelector('em'));
    expect(tile.getAttribute('title')).toBe('Cases: 1');
    tile.querySelector('em')!.textContent = '4';
    describeKpiOnHover(tile);
    expect(tile.getAttribute('title')).toBe('Cases: 4');
  });

  it('keeps a tooltip that was written for the box, and ignores anything that is not a headline box', () => {
    const own = make('<button class="kpi-tile" title="Show every case"><span class="kpi-tile-label">Cases</span><strong class="kpi-tile-value">1</strong></button>');
    describeKpiOnHover(own);
    expect(own.getAttribute('title')).toBe('Show every case');
    const other = make('<div class="card"><span class="kpi-tile-label">x</span></div>');
    describeKpiOnHover(other);
    expect(other.hasAttribute('title')).toBeFalse();
  });
});
