/* @ds-bundle: {"format":4,"namespace":"AnagrabbleDesignSystem_578681","components":[{"name":"Wordmark","sourcePath":"components/brand/Wordmark.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"LetterTile","sourcePath":"components/game/LetterTile.jsx"},{"name":"PlayerChip","sourcePath":"components/game/PlayerChip.jsx"},{"name":"PlayerScoreCard","sourcePath":"components/game/PlayerScoreCard.jsx"},{"name":"Timer","sourcePath":"components/game/Timer.jsx"},{"name":"WordTag","sourcePath":"components/game/WordTag.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/brand/Wordmark.jsx":"a57cbbbabdc5","components/core/Badge.jsx":"9812c60b610d","components/core/Button.jsx":"648f30d21318","components/core/Card.jsx":"bbf1cb1f2e9c","components/core/IconButton.jsx":"388379c2c10b","components/core/Tag.jsx":"b6cf6ff1d42d","components/feedback/Dialog.jsx":"896964c692a2","components/feedback/Toast.jsx":"e92ecd3a05f5","components/feedback/Tooltip.jsx":"40d523dca851","components/forms/Checkbox.jsx":"be02c22d8d7c","components/forms/Input.jsx":"c3734597bbfe","components/forms/Select.jsx":"ebde13dae4ea","components/forms/Switch.jsx":"1b2c7d0e8b01","components/game/LetterTile.jsx":"5ece78fdc42c","components/game/PlayerChip.jsx":"66504877402d","components/game/PlayerScoreCard.jsx":"012449a51ef1","components/game/Timer.jsx":"9286e83d02f3","components/game/WordTag.jsx":"3d3463f548ce","components/navigation/Tabs.jsx":"fa060db2ef21","ui_kits/game/Board.jsx":"4df5113cb39f","ui_kits/game/Header.jsx":"4cc269f64732","ui_kits/game/PlayerRail.jsx":"872b468a632d","ui_kits/game/WordBar.jsx":"5479c9943681","ui_kits/landing/Hero.jsx":"aeb7f92b0bcc","ui_kits/landing/HowItWorks.jsx":"9b015fc30c12","ui_kits/landing/SignupFooter.jsx":"6e3aef9a562d"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AnagrabbleDesignSystem_578681 = window.AnagrabbleDesignSystem_578681 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/Wordmark.jsx
try { (() => {
function Wordmark({
  size = 'md',
  color
}) {
  const px = size === 'sm' ? 16 : size === 'lg' ? 32 : 22;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
      fontSize: px,
      letterSpacing: 'var(--tracking-wide)',
      color: color || 'var(--ink)'
    }
  }, "anagrabble");
}
Object.assign(__ds_scope, { Wordmark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Wordmark.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const tones = {
  success: {
    background: 'var(--surface-accent)',
    color: 'var(--accent-dark)'
  },
  warning: {
    background: 'var(--surface-gold)',
    color: '#8A5C0F'
  },
  error: {
    background: 'var(--error-light)',
    color: 'var(--error)'
  },
  neutral: {
    background: 'var(--surface-sunken)',
    color: 'var(--text-secondary)'
  }
};
function Badge({
  tone = 'neutral',
  children
}) {
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      ...t,
      fontFamily: 'var(--font-body)',
      fontWeight: 600,
      fontSize: 'var(--text-xs)',
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      display: 'inline-flex',
      alignItems: 'center',
      letterSpacing: 'var(--tracking-wide)'
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
const sizeMap = {
  sm: {
    padding: '6px 12px',
    font: 'var(--text-sm)'
  },
  md: {
    padding: '10px 18px',
    font: 'var(--text-base)'
  },
  lg: {
    padding: '13px 24px',
    font: 'var(--text-lg)'
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  children,
  onClick,
  type = 'button'
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const s = sizeMap[size] || sizeMap.md;
  const base = {
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    fontSize: s.font,
    padding: s.padding,
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'background-color 140ms ease-out, border-color 140ms ease-out, transform 100ms ease-out',
    transform: active && !disabled ? 'translateY(1px)' : 'none',
    opacity: disabled ? 0.5 : 1
  };
  const variants = {
    primary: {
      background: hover && !disabled ? 'var(--accent-dark)' : 'var(--accent)',
      color: 'var(--text-on-accent)'
    },
    secondary: {
      background: hover && !disabled ? 'var(--surface-sunken)' : 'var(--surface)',
      color: 'var(--ink)',
      borderColor: hover && !disabled ? 'var(--border-strong)' : 'var(--border)'
    },
    ghost: {
      background: hover && !disabled ? 'var(--surface-sunken)' : 'transparent',
      color: 'var(--ink)'
    },
    danger: {
      background: hover && !disabled ? '#A3392A' : 'var(--error)',
      color: '#fff'
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      ...base,
      ...variants[variant]
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function Card({
  children,
  padding = 'var(--space-5)'
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding
    }
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function IconButton({
  icon,
  label,
  size = 'md',
  disabled = false,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const dim = size === 'sm' ? 32 : size === 'lg' ? 44 : 38;
  return /*#__PURE__*/React.createElement("button", {
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: dim,
      height: dim,
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
      background: hover && !disabled ? 'var(--surface-sunken)' : 'var(--surface)',
      color: 'var(--ink)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background-color 140ms ease-out'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": icon,
    style: {
      width: '18px',
      height: '18px'
    }
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function Tag({
  children,
  onRemove
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      padding: '4px 6px 4px 12px',
      fontFamily: 'var(--font-display)',
      fontWeight: 600,
      fontSize: 'var(--text-sm)',
      color: 'var(--ink)'
    }
  }, children, onRemove && /*#__PURE__*/React.createElement("button", {
    onClick: onRemove,
    "aria-label": "Remove",
    style: {
      width: 18,
      height: 18,
      borderRadius: '50%',
      border: 'none',
      background: 'var(--surface-sunken)',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      fontSize: '11px',
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  open,
  title,
  children,
  onClose
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(27,27,24,0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-md)',
      padding: 'var(--space-6)',
      minWidth: 320,
      maxWidth: 420,
      fontFamily: 'var(--font-body)'
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-xl)',
      color: 'var(--ink)',
      marginBottom: 'var(--space-4)'
    }
  }, title), children));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
const tones = {
  success: {
    background: 'var(--ink)',
    accent: 'var(--accent)'
  },
  error: {
    background: 'var(--ink)',
    accent: 'var(--error)'
  },
  neutral: {
    background: 'var(--ink)',
    accent: 'var(--gold)'
  }
};
function Toast({
  tone = 'neutral',
  children
}) {
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      background: t.background,
      color: '#fff',
      padding: '11px 16px',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: t.accent,
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function Tooltip({
  label,
  children
}) {
  const [show, setShow] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false)
  }, children, show && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: 'calc(100% + 8px)',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--ink)',
      color: '#fff',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-xs)',
      padding: '5px 9px',
      borderRadius: 'var(--radius-sm)',
      whiteSpace: 'nowrap',
      boxShadow: 'var(--shadow-sm)',
      zIndex: 10
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  label,
  checked,
  onChange
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'pointer',
      fontFamily: 'var(--font-body)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => onChange && onChange(!checked),
    style: {
      width: 18,
      height: 18,
      borderRadius: 'var(--radius-sm)',
      border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border-strong)'),
      background: checked ? 'var(--accent)' : 'var(--surface)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background-color 120ms ease-out'
    }
  }, checked && /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "9",
    viewBox: "0 0 11 9"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1 4.5L4 7.5L10 1",
    stroke: "white",
    strokeWidth: "1.6",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--ink)'
    }
  }, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function Input({
  label,
  placeholder,
  value,
  onChange,
  error,
  size = 'md'
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      fontFamily: 'var(--font-body)'
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      fontWeight: 600,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("input", {
    value: value,
    placeholder: placeholder,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: size === 'lg' ? 'var(--text-lg)' : 'var(--text-base)',
      padding: size === 'lg' ? '12px 14px' : '9px 12px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid ' + (error ? 'var(--error)' : focus ? 'var(--accent)' : 'var(--border)'),
      outline: 'none',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none',
      color: 'var(--ink)',
      background: 'var(--surface)',
      transition: 'border-color 120ms ease-out, box-shadow 120ms ease-out'
    }
  }), error && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--error)'
    }
  }, error));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function Select({
  label,
  value,
  onChange,
  options = []
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      fontFamily: 'var(--font-body)'
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      fontWeight: 600,
      color: 'var(--text-secondary)'
    }
  }, label), /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: onChange,
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-base)',
      padding: '9px 12px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      color: 'var(--ink)',
      outline: 'none'
    }
  }, options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  checked,
  onChange,
  label
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      cursor: 'pointer',
      fontFamily: 'var(--font-body)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => onChange && onChange(!checked),
    style: {
      width: 38,
      height: 22,
      borderRadius: 'var(--radius-pill)',
      background: checked ? 'var(--accent)' : 'var(--neutral-500)',
      position: 'relative',
      transition: 'background-color 140ms ease-out',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: '#fff',
      border: '1px solid var(--border-strong)',
      boxShadow: 'var(--shadow-sm)',
      transition: 'left 140ms ease-out'
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--ink)'
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/game/LetterTile.jsx
try { (() => {
function LetterTile({
  letter,
  state = 'up',
  size = 'md',
  highlight = false
}) {
  const dim = size === 'sm' ? 36 : size === 'lg' ? 64 : 48;
  const faceDown = state === 'down';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: dim,
      height: dim,
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-tile)',
      background: faceDown ? 'var(--neutral-300)' : highlight ? 'var(--surface-accent)' : 'var(--tile-face)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: dim * 0.44,
      color: highlight ? 'var(--accent-dark)' : 'var(--ink)',
      textTransform: 'uppercase',
      border: highlight ? '1px solid var(--accent)' : '1px solid transparent',
      transition: 'background-color 150ms ease-out, transform 150ms ease-out'
    }
  }, !faceDown && letter);
}
Object.assign(__ds_scope, { LetterTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/game/LetterTile.jsx", error: String((e && e.message) || e) }); }

// components/game/PlayerChip.jsx
try { (() => {
function PlayerChip({
  name,
  score,
  color = 'var(--accent)',
  isTurn = false,
  selected = false,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      flexShrink: 0,
      cursor: onClick ? 'pointer' : 'default',
      background: 'none',
      border: 'none',
      padding: '4px 2px 6px',
      borderBottom: '2px solid ' + (isTurn ? color : 'transparent'),
      fontFamily: 'var(--font-body)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 9,
      borderRadius: '2px',
      background: color,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 'var(--text-sm)',
      color: 'var(--ink)'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-sm)',
      color: 'var(--gold)'
    }
  }, score));
}
Object.assign(__ds_scope, { PlayerChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/game/PlayerChip.jsx", error: String((e && e.message) || e) }); }

// components/game/PlayerScoreCard.jsx
try { (() => {
function PlayerScoreCard({
  name,
  words = [],
  score,
  isTurn = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid ' + (isTurn ? 'var(--accent)' : 'var(--border)'),
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      minWidth: 180,
      fontFamily: 'var(--font-body)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, isTurn && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 'var(--text-base)',
      color: 'var(--ink)'
    }
  }, name)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-lg)',
      color: 'var(--gold)'
    }
  }, score)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px'
    }
  }, words.length === 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: 'var(--text-sm)'
    }
  }, "No words yet") : words.map(w => /*#__PURE__*/React.createElement("span", {
    key: w,
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--text-sm)',
      fontWeight: 600,
      color: 'var(--ink)',
      background: 'var(--surface-sunken)',
      padding: '2px 8px',
      borderRadius: 'var(--radius-sm)'
    }
  }, w))));
}
Object.assign(__ds_scope, { PlayerScoreCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/game/PlayerScoreCard.jsx", error: String((e && e.message) || e) }); }

// components/game/Timer.jsx
try { (() => {
function Timer({
  seconds,
  total = 30
}) {
  const pct = Math.max(0, Math.min(1, seconds / total));
  const urgent = seconds <= 5;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      fontFamily: 'var(--font-display)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 90,
      height: 6,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-sunken)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct * 100 + '%',
      height: '100%',
      background: urgent ? 'var(--error)' : 'var(--accent)',
      transition: 'width 1000ms linear, background-color 200ms ease-out'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 'var(--text-lg)',
      color: urgent ? 'var(--error)' : 'var(--ink)',
      minWidth: 28,
      textAlign: 'right'
    }
  }, seconds, "s"));
}
Object.assign(__ds_scope, { Timer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/game/Timer.jsx", error: String((e && e.message) || e) }); }

// components/game/WordTag.jsx
try { (() => {
const shapeRadius = {
  pill: 'var(--radius-pill)',
  rounded: 'var(--radius-md)',
  square: 'var(--radius-sm)'
};
function WordTag({
  word,
  color = 'var(--accent)',
  shape = 'pill',
  indicator = 'dot'
}) {
  const radius = shapeRadius[shape] || shapeRadius.pill;
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    borderRadius: radius
  };
  if (indicator === 'outline') {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        ...base,
        color,
        background: 'var(--surface-card)',
        border: '1.5px solid ' + color,
        padding: '4px 10px'
      }
    }, word);
  }
  const swatch = indicator === 'square' ? {
    width: 9,
    height: 9,
    borderRadius: '2px',
    background: color,
    flexShrink: 0
  } : {
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: color,
    flexShrink: 0
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      ...base,
      color: 'var(--ink)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border)',
      padding: '4px 10px 4px 4px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: swatch
  }), word);
}
Object.assign(__ds_scope, { WordTag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/game/WordTag.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  defaultTab
}) {
  const [active, setActive] = React.useState(defaultTab || tabs[0] && tabs[0].id);
  const current = tabs.find(t => t.id === active);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-5)',
      borderBottom: '1px solid var(--border)',
      fontFamily: 'var(--font-body)'
    }
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setActive(t.id),
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '10px 2px',
      fontSize: 'var(--text-sm)',
      fontWeight: 600,
      color: active === t.id ? 'var(--ink)' : 'var(--text-muted)',
      borderBottom: '2px solid ' + (active === t.id ? 'var(--accent)' : 'transparent'),
      marginBottom: '-1px',
      transition: 'color 120ms ease-out'
    }
  }, t.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingTop: 'var(--space-4)'
    }
  }, current && current.content));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/game/Board.jsx
try { (() => {
function Board({
  pool,
  onTurnTile,
  canTurn,
  bankCount,
  timer = 30,
  total = 30,
  currentPlayerName
}) {
  const {
    LetterTile
  } = window.AnagrabbleDesignSystem_578681;
  const pct = Math.max(0, Math.min(1, timer / total));
  const urgent = canTurn && timer <= 5;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-sm)',
      letterSpacing: 'var(--tracking-wider)',
      color: 'var(--text-muted)',
      textTransform: 'uppercase'
    }
  }, "Upturned tiles"), /*#__PURE__*/React.createElement("button", {
    onClick: canTurn ? onTurnTile : undefined,
    disabled: !canTurn,
    style: {
      position: 'relative',
      overflow: 'hidden',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      background: canTurn ? urgent ? 'var(--error)' : 'var(--accent)' : 'var(--neutral-500)',
      color: '#fff',
      cursor: canTurn ? 'pointer' : 'not-allowed',
      opacity: 1,
      padding: '8px 14px',
      fontFamily: 'var(--font-body)',
      fontWeight: 600,
      fontSize: 'var(--text-sm)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, canTurn && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: pct * 100 + '%',
      background: 'rgba(255,255,255,0.22)',
      transition: 'width 1000ms linear'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative'
    }
  }, canTurn ? 'Turn a tile' : `${currentPlayerName}'s turn`), canTurn && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      fontFamily: 'var(--font-display)',
      fontWeight: 700
    }
  }, timer, "s"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      minHeight: 60,
      padding: 'var(--space-4)',
      background: 'var(--surface-sunken)',
      borderRadius: 'var(--radius-lg)'
    }
  }, pool.length === 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
      alignSelf: 'center'
    }
  }, "No tiles turned yet."), pool.map((l, i) => /*#__PURE__*/React.createElement(LetterTile, {
    key: i,
    letter: l
  }))));
}
window.Board = Board;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/game/Board.jsx", error: String((e && e.message) || e) }); }

// ui_kits/game/Header.jsx
try { (() => {
function Header({
  tilesLeft,
  onOpenMenu
}) {
  const {
    Wordmark
  } = window.AnagrabbleDesignSystem_578681;
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface-card)'
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: "md"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '18px',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("span", null, tilesLeft, " tiles left"), onOpenMenu ? /*#__PURE__*/React.createElement("button", {
    onClick: onOpenMenu,
    "aria-label": "Menu",
    style: {
      background: 'none',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "menu",
    style: {
      width: 20,
      height: 20,
      color: 'var(--text-muted)'
    }
  })) : /*#__PURE__*/React.createElement("i", {
    "data-lucide": "settings",
    style: {
      width: 18,
      height: 18,
      color: 'var(--text-muted)'
    }
  })));
}
window.Header = Header;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/game/Header.jsx", error: String((e && e.message) || e) }); }

// ui_kits/game/PlayerRail.jsx
try { (() => {
function PlayerRail({
  players,
  currentTurn
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-sm)',
      letterSpacing: 'var(--tracking-wider)',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      marginBottom: 'var(--space-2)'
    }
  }, "Players"), players.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 0',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 12,
      height: 12,
      borderRadius: '2px',
      background: p.color,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontFamily: 'var(--font-body)',
      fontWeight: 600,
      fontSize: 'var(--text-base)',
      color: 'var(--ink)'
    }
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-base)',
      color: 'var(--gold)'
    }
  }, p.score))));
}
window.PlayerRail = PlayerRail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/game/PlayerRail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/game/WordBar.jsx
try { (() => {
function WordBar({
  value,
  onChange,
  onSubmit
}) {
  const {
    Input,
    Button
  } = window.AnagrabbleDesignSystem_578681;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'flex-end',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 200px',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Type a word\u2026",
    size: "lg",
    value: value,
    onChange: e => onChange(e.target.value)
  })), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: onSubmit
  }, "Play word"));
}
window.WordBar = WordBar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/game/WordBar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/landing/Hero.jsx
try { (() => {
function Hero() {
  const {
    Wordmark,
    Button
  } = window.AnagrabbleDesignSystem_578681;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '90px 24px 70px',
      textAlign: 'center',
      background: 'var(--paper)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: '28px'
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: "lg"
  })), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'clamp(32px, 6vw, 56px)',
      lineHeight: 'var(--leading-tight)',
      color: 'var(--ink)',
      margin: '0 0 18px',
      maxWidth: 720,
      marginLeft: 'auto',
      marginRight: 'auto'
    }
  }, "Steal a word. Add a letter."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-lg)',
      color: 'var(--text-secondary)',
      maxWidth: 520,
      margin: '0 auto 32px',
      lineHeight: 'var(--leading-normal)'
    }
  }, "Anagrabble is a word game for people who read the dictionary for fun. Turn tiles, build words, and steal your friends' \u2014 CAT becomes CAST becomes SCAT."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '12px',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg"
  }, "Play now"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "secondary"
  }, "How it works")));
}
window.Hero = Hero;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/landing/Hero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/landing/HowItWorks.jsx
try { (() => {
function HowItWorks() {
  const {
    LetterTile,
    Card
  } = window.AnagrabbleDesignSystem_578681;
  const steps = [{
    title: 'Turn a tile',
    body: 'On your turn, flip one letter from the bank face-up. Everyone can see it.',
    tiles: ['C']
  }, {
    title: 'Play a word',
    body: 'Spot a word in the upturned tiles? Type it. If it is real and the letters are there, it is yours.',
    tiles: ['C', 'A', 'T']
  }, {
    title: 'Steal a word',
    body: 'Add letters to steal someone else\u2019s word. CAT + S = CAST, and CAT moves to your rack.',
    tiles: ['C', 'A', 'S', 'T']
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '60px 24px 90px',
      background: 'var(--surface-card)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      textAlign: 'center',
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-2xl)',
      color: 'var(--ink)',
      margin: '0 0 40px'
    }
  }, "How it works"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '20px',
      maxWidth: 920,
      margin: '0 auto'
    }
  }, steps.map((s, i) => /*#__PURE__*/React.createElement(Card, {
    key: s.title
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '6px',
      marginBottom: '16px'
    }
  }, s.tiles.map((l, j) => /*#__PURE__*/React.createElement(LetterTile, {
    key: j,
    letter: l,
    size: "sm"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-lg)',
      color: 'var(--ink)',
      marginBottom: '8px'
    }
  }, i + 1, ". ", s.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)',
      lineHeight: 'var(--leading-normal)'
    }
  }, s.body)))));
}
window.HowItWorks = HowItWorks;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/landing/HowItWorks.jsx", error: String((e && e.message) || e) }); }

// ui_kits/landing/SignupFooter.jsx
try { (() => {
function SignupBand() {
  const {
    Input,
    Button
  } = window.AnagrabbleDesignSystem_578681;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '70px 24px',
      background: 'var(--accent)',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--text-2xl)',
      color: '#fff',
      margin: '0 0 20px'
    }
  }, "Get notified when a table opens up"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      justifyContent: 'center',
      flexWrap: 'wrap',
      maxWidth: 420,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 200
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "you@email.com"
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Notify me")));
}
function Footer() {
  const {
    Wordmark
  } = window.AnagrabbleDesignSystem_578681;
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: '28px 24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: '1px solid var(--border)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Anagrabble"));
}
window.SignupBand = SignupBand;
window.Footer = Footer;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/landing/SignupFooter.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.LetterTile = __ds_scope.LetterTile;

__ds_ns.PlayerChip = __ds_scope.PlayerChip;

__ds_ns.PlayerScoreCard = __ds_scope.PlayerScoreCard;

__ds_ns.Timer = __ds_scope.Timer;

__ds_ns.WordTag = __ds_scope.WordTag;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
