import { useEffect, useRef, useState } from 'react';

const OPTIONS = [
  { value: 'it', label: 'IT Help Desk' },
  { value: 'gis', label: 'GIS Request' },
  { value: 'automation', label: 'Automation Idea' }
];

export default function RequestTypeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = OPTIONS.find((o) => o.value === value) || OPTIONS[0];

  function handleSelect(optionValue) {
    onChange(optionValue);
    setOpen(false);
  }

  return (
    <div className="select-type-wrap" ref={wrapRef}>
      <button
        type="button"
        className="select-type-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected.label}</span>
        <svg className="select-type-arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path fill="#0A2350" d="M6 8L1 3h10z" />
        </svg>
      </button>
      {open && (
        <ul className="select-type-list" role="listbox">
          {OPTIONS.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={'select-type-option' + (option.value === value ? ' selected' : '')}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
