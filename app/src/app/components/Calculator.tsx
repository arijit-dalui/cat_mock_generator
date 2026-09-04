"use client";

import { useState, type CSSProperties } from "react";

/** An on-screen calculator for DILR/QA, matching the exact skin used in the
 * real exam - candidates should see the identical calculator on test day as
 * they did in practice, right down to the colors. Keyboard-free by design
 * (the real exam only accepts on-screen clicks). Shared by the sectional
 * and full-mock solving screens. */
export default function Calculator({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState(""); // top line: what's been entered so far, e.g. "12 +"
  const [display, setDisplay] = useState("0"); // bottom line: current entry / result
  const [pending, setPending] = useState<{ op: string; value: number } | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [memory, setMemory] = useState(0);

  function inputDigit(d: string) {
    setDisplay((cur) => (overwrite || cur === "0" ? d : cur + d));
    setOverwrite(false);
  }
  function inputDot() {
    setDisplay((cur) => (overwrite ? "0." : cur.includes(".") ? cur : cur + "."));
    setOverwrite(false);
  }
  function clearAll() {
    setDisplay("0");
    setExpr("");
    setPending(null);
    setOverwrite(true);
  }
  function backspace() {
    setDisplay((cur) => (cur.length > 1 ? cur.slice(0, -1) : "0"));
  }
  function apply(op: string, a: number, b: number): number {
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return b === 0 ? NaN : a / b;
      default: return b;
    }
  }
  const OP_SYMBOL: Record<string, string> = { "+": "+", "-": "-", "*": "*", "/": "/" };
  function chooseOp(op: string) {
    const value = parseFloat(display);
    if (pending) {
      const result = apply(pending.op, pending.value, value);
      setDisplay(String(result));
      setPending({ op, value: result });
      setExpr(`${result} ${OP_SYMBOL[op]}`);
    } else {
      setPending({ op, value });
      setExpr(`${value} ${OP_SYMBOL[op]}`);
    }
    setOverwrite(true);
  }
  function equals() {
    if (!pending) return;
    const b = parseFloat(display);
    const result = apply(pending.op, pending.value, b);
    setExpr(`${pending.value} ${OP_SYMBOL[pending.op]} ${b} =`);
    setDisplay(String(result));
    setPending(null);
    setOverwrite(true);
  }
  function unary(fn: (n: number) => number) {
    setDisplay((cur) => String(fn(parseFloat(cur))));
    setOverwrite(true);
  }

  const grayBtn: CSSProperties = {
    border: "1px solid #d5d5d5",
    background: "#f0f0f0",
    borderRadius: 4,
    padding: "9px 0",
    fontSize: 14,
    fontWeight: 600,
    color: "#333",
    cursor: "pointer",
  };
  const memBtn: CSSProperties = { ...grayBtn, fontSize: 11, padding: "7px 0" };
  const redBtn: CSSProperties = { ...grayBtn, background: "#e05c4e", borderColor: "#e05c4e", color: "#fff" };
  const opBtn: CSSProperties = { ...grayBtn, background: "#dce8f5", borderColor: "#c7d9ee", color: "#1c2b3a" };
  const eqBtn: CSSProperties = { ...grayBtn, background: "#3fa84a", borderColor: "#3fa84a", color: "#fff", fontSize: 16, padding: "10px 0" };

  return (
    <div style={{ position: "fixed", bottom: 70, right: 20, width: 240, background: "#fff", border: "1px solid #c7d0da", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 25, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#3f6db0", color: "#fff", padding: "8px 10px 8px 12px" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Calculator</span>
        <button tabIndex={-1} onClick={onClose} style={{ border: "none", background: "#e07a3f", color: "#fff", borderRadius: 3, width: 18, height: 18, fontSize: 11, lineHeight: 1, cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ border: "1px solid #ccc", borderRadius: 3, padding: "5px 8px", fontFamily: "monospace", fontSize: 12, color: "#555", minHeight: 18, marginBottom: 5, overflowX: "auto", whiteSpace: "nowrap" }}>
          {expr || " "}
        </div>
        <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 20, padding: "6px 8px", background: "#f4f4f4", border: "1px solid #ddd", borderRadius: 3, marginBottom: 8, overflowX: "auto", whiteSpace: "nowrap" }}>
          {display}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 4 }}>
          <button tabIndex={-1} style={memBtn} onClick={() => setMemory(0)}>MC</button>
          <button tabIndex={-1} style={memBtn} onClick={() => { setDisplay(String(memory)); setOverwrite(true); }}>MR</button>
          <button tabIndex={-1} style={memBtn} onClick={() => setMemory(parseFloat(display))}>MS</button>
          <button tabIndex={-1} style={memBtn} onClick={() => setMemory((m) => m + parseFloat(display))}>M+</button>
          <button tabIndex={-1} style={memBtn} onClick={() => setMemory((m) => m - parseFloat(display))}>M-</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 4 }}>
          <button tabIndex={-1} style={redBtn} onClick={backspace}>&larr;</button>
          <button tabIndex={-1} style={redBtn} onClick={clearAll}>C</button>
          <button tabIndex={-1} style={redBtn} onClick={() => setDisplay((d) => String(parseFloat(d) * -1))}>&plusmn;</button>
          <button tabIndex={-1} style={grayBtn} onClick={() => unary((n) => Math.sqrt(n))}>&radic;</button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gridTemplateAreas: `"n7 n8 n9 div pct" "n4 n5 n6 mul recip" "n1 n2 n3 sub eq" "n0 n0 dot add eq"`,
            gap: 4,
          }}
        >
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n7" }} onClick={() => inputDigit("7")}>7</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n8" }} onClick={() => inputDigit("8")}>8</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n9" }} onClick={() => inputDigit("9")}>9</button>
          <button tabIndex={-1} style={{ ...opBtn, gridArea: "div" }} onClick={() => chooseOp("/")}>/</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "pct" }} onClick={() => unary((n) => n / 100)}>%</button>

          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n4" }} onClick={() => inputDigit("4")}>4</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n5" }} onClick={() => inputDigit("5")}>5</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n6" }} onClick={() => inputDigit("6")}>6</button>
          <button tabIndex={-1} style={{ ...opBtn, gridArea: "mul" }} onClick={() => chooseOp("*")}>*</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "recip" }} onClick={() => unary((n) => (n === 0 ? NaN : 1 / n))}>1/x</button>

          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n1" }} onClick={() => inputDigit("1")}>1</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n2" }} onClick={() => inputDigit("2")}>2</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n3" }} onClick={() => inputDigit("3")}>3</button>
          <button tabIndex={-1} style={{ ...opBtn, gridArea: "sub" }} onClick={() => chooseOp("-")}>-</button>

          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "n0" }} onClick={() => inputDigit("0")}>0</button>
          <button tabIndex={-1} style={{ ...grayBtn, gridArea: "dot" }} onClick={inputDot}>.</button>
          <button tabIndex={-1} style={{ ...opBtn, gridArea: "add" }} onClick={() => chooseOp("+")}>+</button>

          {/* Spans the last two rows in the corner, like a real calculator's = key. */}
          <button tabIndex={-1} style={{ ...eqBtn, gridArea: "eq", height: "100%" }} onClick={equals}>=</button>
        </div>
      </div>
    </div>
  );
}
