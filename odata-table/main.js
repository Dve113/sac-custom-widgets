(function () {
  const CELL_SEP = "\u001F";
  const ROW_SEP = "\u001E";
  const EMPTY_LABEL = "(leer)";

  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; font-size: 14px; color: #32363a; }
      .frame { display: flex; flex-direction: column; height: 100%; border: 1px solid #d9d9d9; box-sizing: border-box; }
      .wrap { flex: 1 1 auto; overflow: auto; position: relative; }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e5e5e5; white-space: nowrap; }
      th { position: sticky; top: 0; background: #f2f2f2; font-weight: 600; z-index: 1; user-select: none; }
      th .inner { display: flex; align-items: center; gap: 4px; }
      th .label { cursor: pointer; flex: 1 1 auto; }
      th.num .label { text-align: right; }
      td.num { text-align: right; }
      th .arrow { font-size: 10px; color: #556b82; }
      .funnel { flex: 0 0 auto; width: 18px; height: 18px; border: none; background: transparent; padding: 0; cursor: pointer; border-radius: 3px; line-height: 0; }
      .funnel:hover { background: #e0e4e8; }
      .funnel svg { width: 12px; height: 12px; }
      .funnel path { fill: none; stroke: #6a6d70; stroke-width: 1.4; }
      .funnel.active path { fill: #0a6ed1; stroke: #0a6ed1; }
      tbody tr { cursor: pointer; }
      tbody tr:hover { background: #f7fafd; }
      tbody tr.selected { background: #d9edff; }
      tbody tr.selected td { border-bottom-color: #a8cdf0; }
      .msg { padding: 16px; color: #556b82; }

      .panel { position: absolute; z-index: 5; background: #fff; border: 1px solid #b0b8c0; border-radius: 4px;
               box-shadow: 0 4px 12px rgba(0,0,0,.18); width: 230px; padding: 8px; box-sizing: border-box; }
      .panel[hidden] { display: none; }
      .panel input[type="search"] { width: 100%; box-sizing: border-box; padding: 4px 6px; margin-bottom: 6px;
               border: 1px solid #b0b8c0; border-radius: 3px; font: inherit; font-size: 13px; }
      .panel .values { max-height: 190px; overflow: auto; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
      .panel label { display: flex; align-items: center; gap: 6px; padding: 3px 2px; font-size: 13px; cursor: pointer; white-space: nowrap; }
      .panel label:hover { background: #f2f7fd; }
      .panel label.all { font-weight: 600; border-bottom: 1px solid #eee; }
      .panel .foot { display: flex; justify-content: space-between; align-items: center; padding-top: 6px; }
      .panel button { font: inherit; font-size: 13px; border: 1px solid #b0b8c0; background: #fff; border-radius: 3px; padding: 3px 10px; cursor: pointer; }
      .panel button:hover { background: #f2f2f2; }
      .panel button.link { border: none; background: none; color: #0a6ed1; padding: 3px 2px; }

      .pager { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px;
               padding: 5px 10px; border-top: 1px solid #e5e5e5; background: #fafafa; font-size: 13px; color: #556b82; }
      .pager[hidden] { display: none; }
      .pager .nav { display: flex; align-items: center; gap: 6px; }
      .pager button { font: inherit; border: 1px solid #b0b8c0; background: #fff; border-radius: 3px; padding: 2px 10px; cursor: pointer; }
      .pager button:hover:not(:disabled) { background: #f2f2f2; }
      .pager button:disabled { color: #b0b8c0; border-color: #e0e0e0; cursor: default; }
    </style>
    <div class="frame">
      <div class="wrap" id="wrap">
        <div class="msg" id="msg"></div>
        <table id="tbl" hidden><thead></thead><tbody></tbody></table>
        <div class="panel" id="panel" hidden></div>
      </div>
      <div class="pager" id="pager" hidden>
        <span id="pagerInfo"></span>
        <span class="nav">
          <button id="prev" type="button">◀ Zurück</button>
          <span id="pageLabel"></span>
          <button id="next" type="button">Weiter ▶</button>
        </span>
      </div>
    </div>
  `;

  class ODataTable extends HTMLElement {
    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: "open" });
      this._shadow.appendChild(template.content.cloneNode(true));
      this._props = {
        data: "", columns: "", numericColumns: "",
        emptyText: "Keine Datensätze vorhanden.", decimals: 2,
        selectedIndex: 0, selectedRow: "",
        pageSize: 0, pageIndex: 1, totalCount: 0, requestedSkip: 0
      };
      this._buffer = [];
      this._current = [];
      this._rows = [];
      this._selected = -1;
      this._sort = { col: -1, dir: 1 };
      this._filters = {};        // Spaltenindex -> Set erlaubter Rohwerte
      this._lastFilterColumn = 0;
      this._panelColumn = -1;

      this._onOutsideClick = (e) => {
        const panel = this._shadow.getElementById("panel");
        if (panel.hidden) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.indexOf(panel) === -1) this._closePanel();
      };

      this._shadow.getElementById("prev").addEventListener("click", () => this._changePage(-1));
      this._shadow.getElementById("next").addEventListener("click", () => this._changePage(1));
    }

    /* ---------- SAC-Lebenszyklus ---------- */

    onCustomWidgetBeforeUpdate(changedProperties) {
      this._props = { ...this._props, ...changedProperties };
    }

    onCustomWidgetAfterUpdate(changedProperties) {
      if ("data" in changedProperties) {
        this._rows = this._decode(this._props.data);
        this._buffer = this._rows.map((cells) => cells.slice());
        this._sort = { col: -1, dir: 1 };
        this._pruneFilters();
        this._applySelection(-1, false);
      }
      if ("selectedIndex" in changedProperties) {
        const wanted = (this._props.selectedIndex || 0) - 1;
        if (wanted !== this._selected) this._applySelection(wanted, false);
      }
      this._render();
    }

    connectedCallback() {
      if (!this._rows.length && this._props.data) {
        this._rows = this._decode(this._props.data);
        this._buffer = this._rows.map((cells) => cells.slice());
      }
      document.addEventListener("click", this._onOutsideClick, true);
      this._render();
    }

    disconnectedCallback() {
      document.removeEventListener("click", this._onOutsideClick, true);
    }

    /* ---------- Script-API: Daten aufbauen ---------- */

    clear() {
      this._buffer = [];
      this._current = [];
      this._rows = [];
      this._selected = -1;
      this._closePanel();
      this._props.data = "";
      this._props.selectedIndex = 0;
      this._props.selectedRow = "";
      this._pushProperties({ data: "", selectedIndex: 0, selectedRow: "" });
      this._render();
    }

    setColumns(columns) {
      this._props.columns = columns == null ? "" : String(columns);
      this._pushProperties({ columns: this._props.columns });
      this._render();
    }

    setNumericColumns(columns) {
      this._props.numericColumns = columns == null ? "" : String(columns);
      this._pushProperties({ numericColumns: this._props.numericColumns });
      this._render();
    }

    setDecimals(decimals) {
      const d = parseInt(decimals, 10);
      this._props.decimals = isNaN(d) ? 2 : d;
      this._pushProperties({ decimals: this._props.decimals });
      this._render();
    }

    addText(value) {
      this._current.push({ type: "t", value: value == null ? "" : String(value) });
    }

    addNumber(value) {
      this._current.push({ type: "n", value: value == null ? "" : String(value) });
    }

    addBoolean(value) {
      this._current.push({ type: "t", value: value ? "X" : "" });
    }

    endRow() {
      this._buffer.push(this._current);
      this._current = [];
    }

    addRow(cells, delimiter) {
      const d = delimiter ? String(delimiter) : "|";
      const parts = (cells == null ? "" : String(cells)).split(d);
      this._buffer.push(parts.map((p) => ({ type: "t", value: p })));
    }

    render() {
      if (this._current.length) this.endRow();
      this._rows = this._buffer.map((cells) => cells.slice());
      this._selected = -1;
      this._sort = { col: -1, dir: 1 };
      this._closePanel();
      this._pruneFilters();
      this._props.data = this._encode(this._rows);
      this._props.selectedIndex = 0;
      this._props.selectedRow = "";
      this._pushProperties({ data: this._props.data, selectedIndex: 0, selectedRow: "" });
      this._render();
    }

    /* ---------- Script-API: Auswahl ---------- */

    getRowCount() {
      return this._rows.length;
    }

    getVisibleRowCount() {
      return this._visibleIndexes().length;
    }

    getSelectedRowIndex() {
      return this._selected >= 0 ? this._selected + 1 : 0;
    }

    getSelectedCell(column) {
      return this.getCell(this.getSelectedRowIndex(), column);
    }

    getSelectedCellNumber(column) {
      const raw = this.getSelectedCell(column);
      if (raw === "") return 0;
      const n = parseFloat(String(raw).replace(",", "."));
      return isNaN(n) ? 0 : n;
    }

    getSelectedRow(delimiter) {
      if (this._selected < 0) return "";
      const d = delimiter ? String(delimiter) : "|";
      return this._rows[this._selected].map((c) => c.value).join(d);
    }

    getCell(row, column) {
      const r = (row || 0) - 1;
      const c = (column || 0) - 1;
      if (r < 0 || r >= this._rows.length) return "";
      const cells = this._rows[r];
      if (c < 0 || c >= cells.length) return "";
      return cells[c].value;
    }

    setSelectedRowIndex(index) {
      this._applySelection((index || 0) - 1, false);
      this._render();
    }

    clearSelection() {
      this._applySelection(-1, false);
      this._render();
    }

    /* ---------- Script-API: Filter ---------- */

    clearFilters() {
      this._filters = {};
      this._lastFilterColumn = 0;
      this._closePanel();
      this._dropHiddenSelection();
      this._render();
    }

    getFilteredColumn() {
      return this._lastFilterColumn;
    }

    getFilterValues(column, delimiter) {
      const set = this._filters[(column || 0) - 1];
      if (!set) return "";
      const d = delimiter ? String(delimiter) : "|";
      return [...set].join(d);
    }

    setFilterValues(column, values, delimiter) {
      const c = (column || 0) - 1;
      if (c < 0) return;
      const text = values == null ? "" : String(values);
      if (text === "") {
        delete this._filters[c];
      } else {
        const d = delimiter ? String(delimiter) : "|";
        this._filters[c] = new Set(text.split(d));
      }
      this._lastFilterColumn = c + 1;
      this._dropHiddenSelection();
      this._render();
    }

    /* ---------- Script-API: Paging ---------- */

    setPageSize(size) {
      const n = parseInt(size, 10);
      this._props.pageSize = isNaN(n) || n < 0 ? 0 : n;
      this._pushProperties({ pageSize: this._props.pageSize });
      this._render();
    }

    setTotalCount(count) {
      const n = parseInt(count, 10);
      this._props.totalCount = isNaN(n) || n < 0 ? 0 : n;
      this._pushProperties({ totalCount: this._props.totalCount });
      this._render();
    }

    setPageIndex(index) {
      const n = parseInt(index, 10);
      this._props.pageIndex = isNaN(n) || n < 1 ? 1 : n;
      this._props.requestedSkip = (this._props.pageIndex - 1) * (this._props.pageSize || 0);
      this._pushProperties({ pageIndex: this._props.pageIndex, requestedSkip: this._props.requestedSkip });
      this._render();
    }

    getPageIndex() {
      return this._props.pageIndex || 1;
    }

    getPageSize() {
      return this._props.pageSize || 0;
    }

    getRequestedSkip() {
      return this._props.requestedSkip || 0;
    }

    /* ---------- intern: Auswahl ---------- */

    _applySelection(index, fireEvent) {
      const valid = index >= 0 && index < this._rows.length;
      this._selected = valid ? index : -1;

      const rawRow = valid ? this._rows[index].map((c) => c.value).join(CELL_SEP) : "";
      this._props.selectedIndex = valid ? index + 1 : 0;
      this._props.selectedRow = rawRow;

      this._pushProperties({ selectedIndex: this._props.selectedIndex, selectedRow: rawRow });
      if (fireEvent) this.dispatchEvent(new Event("onRowClick"));
    }

    _dropHiddenSelection() {
      if (this._selected < 0) return;
      if (this._visibleIndexes().indexOf(this._selected) === -1) this._applySelection(-1, false);
    }

    _pushProperties(properties) {
      this.dispatchEvent(new CustomEvent("propertiesChanged", { detail: { properties } }));
    }

    /* ---------- intern: Kodierung ---------- */

    _encode(rows) {
      return rows
        .map((cells) => cells.map((c) => c.type + c.value + CELL_SEP).join("") + ROW_SEP)
        .join("");
    }

    _decode(buffer) {
      if (!buffer) return [];
      return buffer
        .split(ROW_SEP)
        .filter((r) => r.length > 0)
        .map((rowStr) =>
          rowStr
            .split(CELL_SEP)
            .filter((c) => c.length > 0)
            .map((cell) => ({ type: cell.charAt(0), value: cell.slice(1) }))
        )
        .filter((cells) => cells.length > 0);
    }

    /* ---------- intern: Spalten ---------- */

    _colCount() {
      return this._rows.length ? Math.max(...this._rows.map((r) => r.length)) : 0;
    }

    _headers(colCount) {
      const configured = (this._props.columns || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (configured.length) return configured;
      const generated = [];
      for (let i = 0; i < colCount; i++) generated.push("Spalte " + (i + 1));
      return generated;
    }

    _numericFlags(colCount) {
      const marked = new Set(
        (this._props.numericColumns || "")
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
          .map((n) => n - 1)
      );
      const flags = [];
      for (let i = 0; i < colCount; i++) {
        flags[i] = marked.has(i) || this._rows.some((r) => r[i] && r[i].type === "n");
      }
      return flags;
    }

    /* ---------- intern: Filter ---------- */

    // Behält nur Filterwerte, die in den aktuellen Daten vorkommen
    _pruneFilters() {
      Object.keys(this._filters).forEach((key) => {
        const col = parseInt(key, 10);
        const present = new Set(this._rows.map((r) => (r[col] ? r[col].value : "")));
        const kept = new Set([...this._filters[col]].filter((v) => present.has(v)));
        if (kept.size === 0 || kept.size === present.size) delete this._filters[col];
        else this._filters[col] = kept;
      });
    }

    _rowPasses(cells, exceptCol) {
      return Object.keys(this._filters).every((key) => {
        const col = parseInt(key, 10);
        if (col === exceptCol) return true;
        const value = cells[col] ? cells[col].value : "";
        return this._filters[col].has(value);
      });
    }

    _visibleIndexes() {
      const list = [];
      for (let i = 0; i < this._rows.length; i++) {
        if (this._rowPasses(this._rows[i], -1)) list.push(i);
      }
      return list;
    }

    // Auswahlwerte einer Spalte, eingeschränkt durch die Filter der anderen Spalten
    _distinctValues(col) {
      const seen = new Set();
      this._rows.forEach((cells) => {
        if (!this._rowPasses(cells, col)) return;
        seen.add(cells[col] ? cells[col].value : "");
      });
      const numeric = this._numericFlags(this._colCount())[col];
      return [...seen].sort((a, b) => {
        if (numeric) {
          const na = parseFloat(String(a).replace(",", "."));
          const nb = parseFloat(String(b).replace(",", "."));
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
        }
        return String(a).localeCompare(String(b), "de", { numeric: true });
      });
    }

    /* ---------- intern: Filter-Panel ---------- */

    _closePanel() {
      const panel = this._shadow.getElementById("panel");
      panel.hidden = true;
      panel.textContent = "";
      this._panelColumn = -1;
    }

    _openPanel(col, anchor) {
      const panel = this._shadow.getElementById("panel");
      const wrap = this._shadow.getElementById("wrap");
      this._panelColumn = col;
      panel.textContent = "";

      const values = this._distinctValues(col);
      const numeric = this._numericFlags(this._colCount())[col];
      const active = this._filters[col];

      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = "Suchen …";
      panel.appendChild(search);

      const list = document.createElement("div");
      list.className = "values";
      panel.appendChild(list);

      const allLabel = document.createElement("label");
      allLabel.className = "all";
      const allBox = document.createElement("input");
      allBox.type = "checkbox";
      allBox.checked = !active;
      allLabel.appendChild(allBox);
      allLabel.appendChild(document.createTextNode("(Alle)"));
      list.appendChild(allLabel);

      const boxes = [];
      values.forEach((value) => {
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !active || active.has(value);
        box.dataset.value = value;
        const text = value === "" ? EMPTY_LABEL : (numeric ? this._formatNumber(value) : value);
        label.appendChild(box);
        label.appendChild(document.createTextNode(text));
        label.title = text;
        list.appendChild(label);
        boxes.push({ box, label, text });
      });

      const apply = () => {
        const checked = boxes.filter((b) => b.box.checked).map((b) => b.box.dataset.value);
        if (checked.length === 0 || checked.length === values.length) delete this._filters[col];
        else this._filters[col] = new Set(checked);
        allBox.checked = !this._filters[col];
        this._lastFilterColumn = col + 1;
        this._dropHiddenSelection();
        this._renderTable();
        this._renderPager();
        this.dispatchEvent(new Event("onFilterChange"));
      };

      boxes.forEach((b) => b.box.addEventListener("change", apply));

      allBox.addEventListener("change", () => {
        boxes.forEach((b) => { b.box.checked = allBox.checked; });
        apply();
      });

      search.addEventListener("input", () => {
        const term = search.value.toLowerCase();
        boxes.forEach((b) => { b.label.hidden = term !== "" && b.text.toLowerCase().indexOf(term) === -1; });
      });

      const foot = document.createElement("div");
      foot.className = "foot";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "link";
      reset.textContent = "Zurücksetzen";
      reset.addEventListener("click", () => {
        boxes.forEach((b) => { b.box.checked = true; });
        apply();
      });
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Schließen";
      close.addEventListener("click", () => this._closePanel());
      foot.appendChild(reset);
      foot.appendChild(close);
      panel.appendChild(foot);

      panel.hidden = false;

      // unterhalb des Trichters ausrichten, innerhalb der Tabelle halten
      const a = anchor.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      let left = a.left - w.left + wrap.scrollLeft;
      const maxLeft = wrap.scrollLeft + wrap.clientWidth - panel.offsetWidth - 4;
      if (left > maxLeft) left = Math.max(wrap.scrollLeft + 4, maxLeft);
      panel.style.left = left + "px";
      panel.style.top = (a.bottom - w.top + wrap.scrollTop) + "px";
      search.focus();
    }

    /* ---------- intern: Paging ---------- */

    _pageCount() {
      const size = this._props.pageSize || 0;
      const total = this._props.totalCount || 0;
      if (!size || !total) return 0;
      return Math.ceil(total / size);
    }

    _changePage(step) {
      const size = this._props.pageSize || 0;
      if (!size) return;
      const next = (this._props.pageIndex || 1) + step;
      if (next < 1) return;
      const pages = this._pageCount();
      if (pages && next > pages) return;

      this._props.pageIndex = next;
      this._props.requestedSkip = (next - 1) * size;
      this._closePanel();
      this._pushProperties({ pageIndex: next, requestedSkip: this._props.requestedSkip });
      this._renderPager();
      this.dispatchEvent(new Event("onPageChange"));
    }

    /* ---------- intern: Darstellung ---------- */

    _render() {
      this._renderTable();
      this._renderPager();
    }

    _renderTable() {
      const msg = this._shadow.getElementById("msg");
      const tbl = this._shadow.getElementById("tbl");

      if (!this._rows.length) {
        msg.textContent = this._props.emptyText;
        msg.hidden = false;
        tbl.hidden = true;
        return;
      }

      const colCount = this._colCount();
      const headers = this._headers(colCount);
      const numeric = this._numericFlags(colCount);
      const order = this._sortedOrder(numeric, this._visibleIndexes());

      const thead = tbl.querySelector("thead");
      const tbody = tbl.querySelector("tbody");
      thead.textContent = "";
      tbody.textContent = "";

      const headRow = document.createElement("tr");
      for (let i = 0; i < colCount; i++) {
        const th = document.createElement("th");
        if (numeric[i]) th.className = "num";

        const inner = document.createElement("div");
        inner.className = "inner";

        const label = document.createElement("span");
        label.className = "label";
        label.textContent = headers[i] || "";
        if (this._sort.col === i) {
          const arrow = document.createElement("span");
          arrow.className = "arrow";
          arrow.textContent = this._sort.dir === 1 ? " ▲" : " ▼";
          label.appendChild(arrow);
        }
        label.addEventListener("click", () => {
          this._sort = { col: i, dir: this._sort.col === i ? -this._sort.dir : 1 };
          this._closePanel();
          this._renderTable();
        });

        const funnel = document.createElement("button");
        funnel.type = "button";
        funnel.className = "funnel" + (this._filters[i] ? " active" : "");
        funnel.title = this._filters[i] ? "Filter ändern" : "Filtern";
        funnel.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2 3h12l-5 6v4l-2 1V9z"/></svg>';
        funnel.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this._panelColumn === i) this._closePanel();
          else this._openPanel(i, funnel);
        });

        inner.appendChild(label);
        inner.appendChild(funnel);
        th.appendChild(inner);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);

      if (!order.length) {
        msg.textContent = "Kein Datensatz entspricht dem Filter.";
        msg.hidden = false;
      } else {
        msg.hidden = true;
      }

      const frag = document.createDocumentFragment();
      order.forEach((rowIndex) => {
        const cells = this._rows[rowIndex];
        const tr = document.createElement("tr");
        if (rowIndex === this._selected) tr.className = "selected";
        for (let i = 0; i < colCount; i++) {
          const td = document.createElement("td");
          const cell = cells[i];
          if (cell) {
            td.textContent = numeric[i] ? this._formatNumber(cell.value) : cell.value;
            if (numeric[i]) td.className = "num";
          }
          tr.appendChild(td);
        }
        tr.addEventListener("click", () => {
          const next = rowIndex === this._selected ? -1 : rowIndex;
          this._applySelection(next, true);
          this._renderTable();
        });
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);
      tbl.hidden = false;
    }

    _renderPager() {
      const pager = this._shadow.getElementById("pager");
      const size = this._props.pageSize || 0;

      if (!size) {
        pager.hidden = true;
        return;
      }

      const page = this._props.pageIndex || 1;
      const total = this._props.totalCount || 0;
      const pages = this._pageCount();
      const loaded = this._rows.length;
      const visible = this._visibleIndexes().length;

      const from = loaded ? (page - 1) * size + 1 : 0;
      const to = (page - 1) * size + loaded;

      let info;
      if (total) {
        info = `${this._int(from)}–${this._int(to)} von ${this._int(total)}`;
      } else if (loaded) {
        info = `${this._int(from)}–${this._int(to)}`;
      } else {
        info = "";
      }
      if (visible !== loaded) info += ` (${this._int(visible)} nach Filter)`;

      this._shadow.getElementById("pagerInfo").textContent = info;
      this._shadow.getElementById("pageLabel").textContent =
        pages ? `Seite ${this._int(page)} von ${this._int(pages)}` : `Seite ${this._int(page)}`;

      this._shadow.getElementById("prev").disabled = page <= 1;
      this._shadow.getElementById("next").disabled = pages ? page >= pages : loaded < size;

      pager.hidden = false;
    }

    _sortedOrder(numeric, indexes) {
      const order = indexes.slice();
      const { col, dir } = this._sort;
      if (col < 0) return order;
      return order.sort((ia, ib) => {
        const x = this._rows[ia][col], y = this._rows[ib][col];
        if (!x && !y) return 0;
        if (!x) return 1;
        if (!y) return -1;
        if (numeric[col]) {
          const nx = parseFloat(x.value.replace(",", "."));
          const ny = parseFloat(y.value.replace(",", "."));
          if (!isNaN(nx) && !isNaN(ny)) return (nx - ny) * dir;
        }
        return x.value.localeCompare(y.value, "de", { numeric: true }) * dir;
      });
    }

    _int(n) {
      return Number(n).toLocaleString("de-DE");
    }

    _formatNumber(raw) {
      if (raw === "") return "";
      const n = parseFloat(String(raw).replace(",", "."));
      if (isNaN(n)) return raw;
      const d = typeof this._props.decimals === "number" ? this._props.decimals : 2;
      return n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
    }
  }

  customElements.define("com-example-odata-table", ODataTable);
})();
