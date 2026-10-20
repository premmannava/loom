import type { ComponentDef } from "../component";

const VARIANTS = ["primary", "secondary", "danger"] as const;

export const button: ComponentDef = {
  type: "button",
  category: "input",
  description: "A pressable button that runs actions. Use emit: to tell the app what the user chose.",
  text: { description: "The button label.", required: true },
  props: {
    on: { type: "action", description: "What happens when pressed, e.g. inc:count, set:done:true, emit:book. Separate several with ;" },
    variant: { type: "enum", values: VARIANTS, default: "primary", description: "primary (filled), secondary (outlined) or danger." },
    disabled: { type: "condition", description: "Expression; when true the button is greyed out and can't be pressed." },
  },
  example: `button "Book now" on=emit:book
button "Back" variant=secondary on=dec:step`,
  layout(box, ctx) {
    box.h = ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const variant = p.oneOf("variant", VARIANTS, "primary");
    const disabled = p.cond("disabled");
    const hot = !disabled && ctx.isHovered(box.node);
    const down = !disabled && ctx.isPressed(box.node);
    const color = variant === "danger" ? c.bad : c.accent;
    if (disabled) g.globalAlpha *= 0.45;
    const inset = down ? 1 : 0;
    ctx.roundRect(box.x + 0.5 + inset, box.y + 0.5 + inset, box.w - 1 - inset * 2, box.h - 1 - inset * 2, theme.radius.md);
    if (variant === "secondary") {
      g.fillStyle = c.surface;
      g.fill();
      if (hot) { g.save(); g.globalAlpha *= 0.1; g.fillStyle = color; g.fill(); g.restore(); }
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.stroke();
    } else {
      g.fillStyle = color;
      g.fill();
      if (hot) { g.save(); g.globalAlpha *= 0.14; g.fillStyle = c.onAccent; g.fill(); g.restore(); }
    }
    g.font = ctx.font(600, 14);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = variant === "secondary" ? color : c.onAccent;
    g.fillText(p.text(), box.x + box.w / 2, box.y + box.h / 2 + 1, box.w - 16);
    if (!disabled) ctx.addHit(box);
  },
};

export const check: ComponentDef = {
  type: "check",
  category: "input",
  description: "A checkbox that toggles a true/false state value.",
  text: { description: "The label next to the box.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The state name this checkbox reads and writes." },
  },
  example: `state agreed=false
check "I agree to the terms" bind=agreed`,
  layout(box) {
    box.h = 26;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const key = p.raw("bind") ?? "";
    const on = !!ctx.scope(key);
    const hot = ctx.isHovered(box.node);
    ctx.roundRect(box.x + 0.5, box.y + 4.5, 18, 18, theme.radius.sm);
    if (on) {
      g.fillStyle = c.accent;
      g.fill();
      g.strokeStyle = c.onAccent;
      g.lineWidth = 2.2;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(box.x + 5, box.y + 13.5);
      g.lineTo(box.x + 8.5, box.y + 17);
      g.lineTo(box.x + 14.5, box.y + 10);
      g.stroke();
    } else {
      g.fillStyle = c.surface;
      g.fill();
      g.strokeStyle = hot ? c.accent : c.muted;
      g.lineWidth = 1.4;
      g.stroke();
    }
    g.font = ctx.font(400, theme.text.body);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = c.ink;
    g.fillText(p.text(), box.x + 30, box.y + 14, box.w - 30);
    ctx.addHit(box);
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (key) ctx.set(key, !ctx.scope(key));
  },
};
