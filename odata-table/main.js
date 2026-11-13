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
      tbody tr:hover { background: #f7fafd; }
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
        emptyText: "Keine Datensätze vorhanden.", decimals: 2
      };
      this._rows = [];
      this._sort = { col: -1, dir: 1 };
    }

    onCustomWidgetBeforeUpdate(changedProperties) {
      this._props = { ...this._props, ...changedProperties };
    }

    onCustomWidgetAfterUpdate(changedProperties) {
      if ("data" in changedProperties) {
        this._rows = this._parse(this._props.data);
        this._sort = { col: -1, dir: 1 };
      }
      this._render();
    }

    connectedCallback() {
      this._render();
    }

    // Pufferformat: je Zelle Typkennzeichen (t|n) + Wert + CELL_SEP, je Zeile ROW_SEP
    _parse(buffer) {
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

    // numerisch, wenn per addNumber geliefert oder über numericColumns markiert
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
      const rows = this._sortedRows(numeric);

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
      rows.forEach((cells) => {
        const tr = document.createElement("tr");
        for (let i = 0; i < colCount; i++) {
          const td = document.createElement("td");
          const cell = cells[i];
          if (cell) {
            td.textContent = numeric[i] ? this._formatNumber(cell.value) : cell.value;
            if (numeric[i]) td.className = "num";
          }
          tr.appendChild(td);
        }
        tr.addEventListener("click", () => this.dispatchEvent(new Event("onRowClick")));
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);

      msg.hidden = true;
      tbl.hidden = false;
    }

    _sortedRows(numeric) {
      const { col, dir } = this._sort;
      if (col < 0) return this._rows;
      return [...this._rows].sort((a, b) => {
        const x = a[col], y = b[col];
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
