(function () {
	'use strict';

	const STYLE_ID = 'fuwa-gomen-styles';
	if (document.getElementById(STYLE_ID)) return;

	const css = `
#gomen[v-cloak]{display:none}
main.phone-screen{
	position:relative;
	display:flex;
	flex-direction:column;
	width:100%;
	height:100%;
	min-height:100%;
	overflow:hidden;
}
#gomen{
	--ink:#2a2320;
	--cream:#fff8ef;
	--pink:#f9a8c4;
	--pink-deep:#e7558b;
	--sakura:#f472b6;
	position:relative;
	flex:1 1 auto;
	align-self:stretch;
	width:100%;
	min-height:0;
	overflow:hidden;
	display:flex;
	flex-direction:column;
	gap:10px;
	padding:38px 14px 18px;
	background:
		radial-gradient(#f0ddc8 1.4px, transparent 1.4px) 0 0 / 22px 22px,
		linear-gradient(180deg,#fff8ef 0%,#fdeede 100%);
	color:var(--ink);
	font-family:'M PLUS Rounded 1c','Nunito',system-ui,sans-serif;
	-webkit-tap-highlight-color:transparent;
	user-select:none;
}
#gomen *{box-sizing:border-box}

/* budget bar */
#gomen .fg-bar{
	position:relative;
	height:24px;
	border:2px solid var(--ink);
	border-radius:999px;
	background:#efe6da;
	overflow:hidden;
}
#gomen .fg-fill{
	position:absolute;inset:0 auto 0 0;height:100%;
	background:linear-gradient(90deg,#86efac,#4ade80);
	transition:width .4s cubic-bezier(.34,1.4,.5,1);
}
#gomen .fg-fill.is-low{background:linear-gradient(90deg,#fca5a5,#f87171)}
#gomen .fg-bar-text{
	position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
	font-size:11px;font-weight:800;color:var(--ink);text-shadow:0 1px 0 rgba(255,255,255,.7);
	white-space:nowrap;
}

/* speech bubble */
#gomen .fg-bubble{
	position:relative;align-self:center;max-width:92%;
	margin-top:2px;padding:8px 14px;
	background:#fff;border:2px solid var(--ink);border-radius:14px;
	box-shadow:2px 3px 0 var(--sakura);
	text-align:center;display:flex;flex-direction:column;gap:1px;
}
#gomen .fg-bubble b{font-size:14px;font-weight:900}
#gomen .fg-bubble span{font-size:11px;font-weight:700;color:#6b5e57}
#gomen .fg-bubble::after{
	content:'';position:absolute;bottom:-9px;left:50%;transform:translateX(-50%);
	border-width:9px 7px 0;border-style:solid;border-color:var(--ink) transparent transparent;
}

/* mascot */
#gomen .fg-kao{
	align-self:center;
	font-family:'M PLUS Rounded 1c',sans-serif;
	font-weight:900;font-size:clamp(44px,17vw,58px);line-height:1;
	white-space:nowrap;color:var(--ink);
	will-change:transform;
}
#gomen .fg-kao .blush{color:var(--sakura)}
#gomen .fg-name{align-self:center;font-size:10px;font-weight:800;letter-spacing:.22em;color:#b7a79e}

#gomen[data-mood="tantrum"] .fg-kao{color:#dc2626}
#gomen[data-mood="annoyed"] .fg-kao{color:#b45309}
#gomen[data-mood="stern"] .fg-kao{color:#9a6a2f}
#gomen[data-mood="worried"] .fg-kao{color:#a16207}
#gomen[data-mood="happy"] .fg-kao{color:var(--pink-deep)}
#gomen[data-mood="crying"] .fg-kao{color:#5b6b8c}

/* papa */
#gomen .fg-papa{
	align-self:center;display:none;align-items:center;gap:6px;
	padding:4px 12px;background:#e0ecff;border:2px solid #3b5b8c;border-radius:12px;
	font-size:11px;font-weight:800;color:#2d4a78;
}
#gomen .fg-papa-kao{font-size:15px;font-weight:900}

/* food shelf (tight row, fits 4 at 320px) */
#gomen .fg-shelf{display:flex;gap:6px;margin-top:2px}
#gomen .fg-food{
	flex:1 1 0;min-width:0;
	display:flex;flex-direction:column;align-items:center;gap:2px;
	padding:6px 4px;background:#fff;border:2px solid var(--ink);border-radius:10px;
	box-shadow:0 3px 0 var(--ink);cursor:pointer;font-family:inherit;
	transition:transform .08s,box-shadow .08s;
}
#gomen .fg-food:active{transform:translateY(3px);box-shadow:0 0 0 var(--ink)}
#gomen .fg-food-icon{font-size:24px;line-height:1}
#gomen .fg-food-price{
	font-size:10px;font-weight:900;padding:0 6px;
	background:#fde68a;border:1.5px solid var(--ink);border-radius:7px;color:#5c3b00;
}

/* receipt / ledger (one row per purchase) */
#gomen .fg-receipt{
	background:#fffdf8;border:2px dashed #cdbfae;border-radius:10px;padding:6px 10px;
}
#gomen .fg-receipt-head{
	font-size:9px;font-weight:900;letter-spacing:.18em;color:#a8907a;
	text-align:center;margin-bottom:4px;
}
#gomen .fg-receipt-list{display:flex;flex-direction:column;gap:3px;max-height:96px;overflow-y:auto}
#gomen .fg-receipt-row{
	display:flex;align-items:center;gap:5px;
	font-family:'Nunito',monospace;font-size:12px;font-weight:800;color:#5c4d44;
}
#gomen .fg-receipt-icon{flex-shrink:0;font-size:14px}
#gomen .fg-receipt-name{flex-shrink:0}
#gomen .fg-receipt-qty{flex-shrink:0;font-size:11px;color:#a8907a}
#gomen .fg-receipt-dots{flex:1;border-bottom:1.5px dotted #d8cab8;height:0;min-width:8px}
#gomen .fg-receipt-price{flex-shrink:0;color:#b45309}
#gomen .fg-receipt-total{
	display:flex;align-items:center;gap:5px;margin-top:5px;padding-top:5px;
	border-top:2px solid #cdbfae;
	font-family:'Nunito',monospace;font-size:13px;font-weight:900;color:#2a2320;
}
#gomen .fg-receipt-total-label{flex-shrink:0}
#gomen .fg-receipt-total-val{flex-shrink:0;color:#b45309}

/* kaomoji action buttons */
#gomen .fg-actions{display:flex;gap:6px;margin-top:2px}
#gomen .fg-btn{
	flex:1;padding:8px 4px;border:2px solid var(--ink);border-radius:10px;
	background:#fff;color:var(--ink);font-family:inherit;font-size:12px;font-weight:900;
	cursor:pointer;box-shadow:0 3px 0 var(--ink);white-space:nowrap;
	transition:transform .08s,box-shadow .08s;
}
#gomen .fg-btn:active{transform:translateY(3px);box-shadow:0 0 0 var(--ink)}
`;

	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = css;
	document.head.appendChild(style);
})();
