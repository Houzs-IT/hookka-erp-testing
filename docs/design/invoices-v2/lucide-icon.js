// <l-icon name="Menu" size="20" stroke-width="1.75" color="#6B5C32"> — renders the real lucide icon (repo uses lucide-react) into a shadow root so React's light DOM is untouched.
(function () {
  if (customElements.get("l-icon")) return;
  class LIcon extends HTMLElement {
    static get observedAttributes() { return ["name", "size", "stroke-width", "color"]; }
    constructor() { super(); this._root = this.attachShadow({ mode: "open" }); }
    connectedCallback() { this.style.display = "inline-flex"; this.style.flex = "none"; this.render(); }
    attributeChangedCallback() { this.render(); }
    render() {
      const L = window.lucide;
      if (!L) { if (!this._w) { this._w = setTimeout(() => { this._w = null; this.render(); }, 60); } return; }
      const node = L.icons[this.getAttribute("name")];
      if (!node) { this._root.replaceChildren(); return; }
      const svg = L.createElement(node);
      const s = this.getAttribute("size") || "24";
      svg.setAttribute("width", s); svg.setAttribute("height", s);
      svg.setAttribute("stroke-width", this.getAttribute("stroke-width") || "1.75");
      svg.setAttribute("stroke", this.getAttribute("color") || "currentColor");
      svg.setAttribute("aria-hidden", "true");
      svg.style.display = "block";
      this._root.replaceChildren(svg);
    }
  }
  customElements.define("l-icon", LIcon);
})();
