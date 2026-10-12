// Inline SVG icons — single stroke style, 1.5px, currentColor.
// All icons are 18×18 by default and size via the `s` prop.

const Icon = ({ children, s = 18, style, ...rest }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', flexShrink: 0, ...style }} {...rest}>
    {children}
  </svg>
);

const IChevR  = (p) => <Icon {...p}><path d="M9 6l6 6-6 6" /></Icon>;
const IChevD  = (p) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
const IChevU  = (p) => <Icon {...p}><path d="M6 15l6-6 6 6" /></Icon>;
const IChevL  = (p) => <Icon {...p}><path d="M15 6l-6 6 6 6" /></Icon>;
const IPlus   = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
const IMinus  = (p) => <Icon {...p}><path d="M5 12h14" /></Icon>;
const IDots   = (p) => <Icon {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/></Icon>;
const ITrash  = (p) => <Icon {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></Icon>;
const IBell   = (p) => <Icon {...p}><path d="M6 8a6 6 0 1 1 12 0v4l1.5 3h-15L6 12V8zM10 19a2 2 0 0 0 4 0"/></Icon>;
const IBellOn = (p) => <Icon {...p}><path d="M6 8a6 6 0 1 1 12 0v4l1.5 3h-15L6 12V8zM10 19a2 2 0 0 0 4 0" fill="currentColor" fillOpacity=".18"/></Icon>;
const ICheck  = (p) => <Icon {...p}><path d="M4 12l5 5L20 6"/></Icon>;
const IX      = (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>;
const ISearch = (p) => <Icon {...p}><circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/></Icon>;
const IClock  = (p) => <Icon {...p}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></Icon>;
const ICal    = (p) => <Icon {...p}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></Icon>;
const ISun    = (p) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></Icon>;
const IMoon   = (p) => <Icon {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></Icon>;
const IFlame  = (p) => <Icon {...p}><path d="M12 3s4 4 4 8a4 4 0 1 1-8 0c0-2 1-3 1-3s.5 2 2 2c0-3-1-5 1-7zM8 13c-1 1-2 2-2 4a6 6 0 0 0 12 0c0-2-1-3-2-4"/></Icon>;
const IGrip   = (p) => <Icon {...p}><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></Icon>;
const ISparkles = (p) => <Icon {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z"/></Icon>;
const IArrowR = (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>;
const IInfo   = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></Icon>;
const IExport = (p) => <Icon {...p}><path d="M12 3v12M7 8l5-5 5 5M5 21h14"/></Icon>;
const IImport = (p) => <Icon {...p}><path d="M12 15V3M7 10l5 5 5-5M5 21h14"/></Icon>;
const ILink   = (p) => <Icon {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5"/></Icon>;
const IShield = (p) => <Icon {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/></Icon>;
const IEye    = (p) => <Icon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></Icon>;
const IEyeOff = (p) => <Icon {...p}><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 22 12s-1.6 3-4.7 5M6.6 6.6C3.6 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></Icon>;
const IRefresh= (p) => <Icon {...p}><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></Icon>;
const ITag    = (p) => <Icon {...p}><path d="M20 12l-8 8-9-9V3h8l9 9z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/></Icon>;
const IMove   = (p) => <Icon {...p}><path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/></Icon>;
const IDownload= (p) => <Icon {...p}><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></Icon>;
const IUser   = (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></Icon>;
const IFilter = (p) => <Icon {...p}><path d="M4 5h16l-6 8v6l-4-2v-4L4 5z"/></Icon>;

Object.assign(window, {
  Icon, IChevR, IChevD, IChevU, IChevL, IPlus, IMinus, IDots, ITrash,
  IBell, IBellOn, ICheck, IX, ISearch, IClock, ICal, ISun, IMoon, IFlame,
  IGrip, ISparkles, IArrowR, IInfo, IExport, IImport, ILink, IShield, IEye,
  IEyeOff, IRefresh, ITag, IMove, IDownload, IUser, IFilter
});
