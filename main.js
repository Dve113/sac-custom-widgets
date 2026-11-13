(function () {
  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; font-size: 14px; }
      .wrap { height: 100%; overflow: auto; border: 1px solid #d9d9d9; box-sizing: border-box; }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e5e5e5; white-space: nowrap; }
      th { position: sticky; top: 0; background: #f2f2f2; font-weight: 600; z-index: 1; cursor: pointer; user-select: none; }
      th .arrow { font-size: 10px; margin-left: 4px; color: #556b82; }
      tbody tr:hover { background: #f7fafd; }
      tbody tr { cursor: default; }
      .msg { padding: 16px; color: #556b82; }
      .msg.error { color: #bb0000; }
    </style>
    <div class="wrap"><div class="msg" id="msg"></div><table id="tbl" hidden><thead></thead><tbody></tbody></table></div>
  `;

  class ODataTable extends HTMLElement {
    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: "open" });
      this._shadow.appendChild(template.content.cloneNode(true));
      this._props = { data: "[]", columns: "", emptyText: "Keine Datensätze vorhanden." };
      this._rows = [];
      this._sort = { col: null, dir: 1 };
    }

    onCustomWidgetBeforeUpdate(changedProperties) {
      this._props = { ...this._props, ...changedProperties };
    }

    onCustomWidgetAfterUpdate(changedProperties) {
      if ("data" in changedProperties) {
        this._rows = this._parse(this._props.data);
        this._sort = { col: null, dir: 1 };
      }
      if ("data" in changedProperties || "columns" in changedProperties || "emptyText" in changedProperties) {
        this._render();
      }
    }

    connectedCallback() {
      this._render();
    }

    _parse(json) {
      if (!json) return [];
      try {
        const parsed = typeof json === "string" ? JSON.parse(json) : json;
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.value)) return parsed.value; // OData V4 Rohantwort
        return [];
      } catch (e) {
        console.error("OData Table: ungültiges JSON", e);
        this._error = "Ungültige Daten (kein JSON-Array).";
        return [];
      }
    }

    _columns() {
      const configured = (this._props.columns || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (configured.length) return configured;
      if (!this._rows.length) return [];
      const first = this._rows[0];
      return Object.keys(first).filter((k) => {
        if (k === "__metadata" || k.startsWith("@odata")) return false;
        const v = first[k];
        return v === null || typeof v !== "object";
      });
    }

    _showMessage(text, isError) {
      const msg = this._shadow.getElementById("msg");
      msg.textContent = text;
      msg.className = "msg" + (isError ? " error" : "");
      msg.hidden = false;
      this._shadow.getElementById("tbl").hidden = true;
    }

    _render() {
      if (this._error) {
        const err = this._error;
        this._error = null;
        this._showMessage(err, true);
        return;
      }
      if (!this._rows.length) {
        this._showMessage(this._props.emptyText);
        return;
      }

      const columns = this._columns();
      const rows = this._sortedRows();
      const tbl = this._shadow.getElementById("tbl");
      const thead = tbl.querySelector("thead");
      const tbody = tbl.querySelector("tbody");
      thead.textContent = "";
      tbody.textContent = "";

      const headRow = document.createElement("tr");
      columns.forEach((c) => {
        const th = document.createElement("th");
        th.textContent = c;
        if (this._sort.col === c) {
          const arrow = document.createElement("span");
          arrow.className = "arrow";
          arrow.textContent = this._sort.dir === 1 ? "▲" : "▼";
          th.appendChild(arrow);
        }
        th.addEventListener("click", () => {
          this._sort = { col: c, dir: this._sort.col === c ? -this._sort.dir : 1 };
          this._render();
        });
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);

      const frag = document.createDocumentFragment();
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        columns.forEach((c) => {
          const td = document.createElement("td");
          td.textContent = this._format(row[c]);
          tr.appendChild(td);
        });
        tr.addEventListener("click", () => this.dispatchEvent(new Event("onRowClick")));
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);

      this._shadow.getElementById("msg").hidden = true;
      tbl.hidden = false;
    }

    _sortedRows() {
      const { col, dir } = this._sort;
      if (!col) return this._rows;
      return [...this._rows].sort((a, b) => {
        const x = a[col], y = b[col];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return String(x).localeCompare(String(y), "de", { numeric: true }) * dir;
      });
    }

    _format(v) {
      if (v === null || v === undefined) return "";
      if (typeof v === "string") {
        const m = /^\/Date\((-?\d+)\)\/$/.exec(v); // V2-Datum, falls vorhanden
        if (m) return new Date(Number(m[1])).toLocaleDateString("de-DE");
      }
      return String(v);
    }
  }

  customElements.define("com-example-odata-table", ODataTable);
})();
