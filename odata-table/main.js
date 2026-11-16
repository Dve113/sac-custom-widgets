(function () {
  const CELL_SEP = "\u001F";
  const ROW_SEP = "\u001E";

  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; font-size: 14px; }
      .wrap { height: 100%; overflow: auto; border: 1px solid #d9d9d9; box-sizing: border-box; }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e5e5e5; white-space: nowrap; }
      th { position: sticky; top: 0; background: #f2f2f2; font-weight: 600; z-index: 1; cursor: pointer; user-select: none; }
      th.num, td.num { text-align: right; }
      th .arrow { font-size: 10px; margin-left: 4px; color: #556b82; }
      tbody tr { cursor: pointer; }
      tbody tr:hover { background: #f7fafd; }
      tbody tr.selected { background: #d9edff; }
      tbody tr.selected td { border-bottom-color: #a8cdf0; }
      .msg { padding: 16px; color: #556b82; }
    </style>
    <div class="wrap"><div class="msg" id="msg"></div><table id="tbl" hidden><thead></thead><tbody></tbody></table></div>
  `;

  class ODataTable extends HTMLElement {
    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: "open" });
      this._shadow.appendChild(template.content.cloneNode(true));
      this._props = {
        data: "", columns: "", numericColumns: "",
        emptyText: "Keine Datensätze vorhanden.", decimals: 2,
        selectedIndex: 0, selectedRow: ""
      };
      this._buffer = [];   // gesammelte Zeilen, noch nicht angezeigt
      this._current = [];  // Zellen der Zeile, die gerade aufgebaut wird
      this._rows = [];     // angezeigte Zeilen
      this._selected = -1; // 0-basiert, -1 = keine Auswahl
      this._sort = { col: -1, dir: 1 };
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
      this._render();
    }

    /* ---------- Script-API: Daten aufbauen ---------- */

    clear() {
      this._buffer = [];
      this._current = [];
      this._rows = [];
      this._selected = -1;
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
      this._props.data = this._encode(this._rows);
      this._props.selectedIndex = 0;
      this._props.selectedRow = "";
      this._pushProperties({ data: this._props.data, selectedIndex: 0, selectedRow: "" });
      this._render();
    }

    /* ---------- Script-API: Auswahl lesen ---------- */

    getRowCount() {
      return this._rows.length;
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

    /* ---------- intern ---------- */

    _applySelection(index, fireEvent) {
      const valid = index >= 0 && index < this._rows.length;
      this._selected = valid ? index : -1;

      const rawRow = valid ? this._rows[index].map((c) => c.value).join(CELL_SEP) : "";
      this._props.selectedIndex = valid ? index + 1 : 0;
      this._props.selectedRow = rawRow;

      this._pushProperties({ selectedIndex: this._props.selectedIndex, selectedRow: rawRow });
      if (fireEvent) this.dispatchEvent(new Event("onRowClick"));
    }

    _pushProperties(properties) {
      this.dispatchEvent(new CustomEvent("propertiesChanged", { detail: { properties } }));
    }

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

    _render() {
      const msg = this._shadow.getElementById("msg");
      const tbl = this._shadow.getElementById("tbl");

      if (!this._rows.length) {
        msg.textContent = this._props.emptyText;
        msg.hidden = false;
        tbl.hidden = true;
        return;
      }

      const colCount = Math.max(...this._rows.map((r) => r.length));
      const headers = this._headers(colCount);
      const numeric = this._numericFlags(colCount);
      const order = this._sortedOrder(numeric);

      const thead = tbl.querySelector("thead");
      const tbody = tbl.querySelector("tbody");
      thead.textContent = "";
      tbody.textContent = "";

      const headRow = document.createElement("tr");
      for (let i = 0; i < colCount; i++) {
        const th = document.createElement("th");
        th.textContent = headers[i] || "";
        if (numeric[i]) th.className = "num";
        if (this._sort.col === i) {
          const arrow = document.createElement("span");
          arrow.className = "arrow";
          arrow.textContent = this._sort.dir === 1 ? "▲" : "▼";
          th.appendChild(arrow);
        }
        th.addEventListener("click", () => {
          this._sort = { col: i, dir: this._sort.col === i ? -this._sort.dir : 1 };
          this._render();
        });
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);

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
          this._render();
        });
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);

      msg.hidden = true;
      tbl.hidden = false;
    }

    _sortedOrder(numeric) {
      const order = this._rows.map((_, i) => i);
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
