import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { navigation } from './navigation'

export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const matches = navigation.filter((item) =>
    `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase()),
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      dialog.current?.showModal()
      input.current?.focus()
    } else if (dialog.current?.open) {
      dialog.current.close()
      trigger.current?.focus()
    }
  }, [open])
  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }
  useEffect(() => {
    if (open)
      document.getElementById(`command-option-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, selected])
  return (
    <>
      <button
        ref={trigger}
        className="command-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search pages"
        aria-haspopup="dialog"
      >
        <Search size={16} />
        <span>Quick navigation</span>
        <kbd>Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="command-dialog"
        aria-label="Quick navigation"
        onCancel={(event) => {
          event.preventDefault()
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false)
        }}
      >
        <div className="command-search">
          <Search size={20} />
          <label id="command-title" className="sr-only" htmlFor="command-input">
            Find a page
          </label>
          <input
            id="command-input"
            ref={input}
            value={query}
            placeholder="Where would you like to go?"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="command-options"
            aria-activedescendant={matches.length ? `command-option-${selected}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((i) => (matches.length ? (i + 1) % matches.length : 0))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
              }
              if (event.key === 'Enter' && matches[selected]) {
                event.preventDefault()
                go(matches[selected].to)
              }
            }}
          />
          <button className="icon-button" aria-label="Close search" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="command-results">
          <div className="eyebrow">YOUR WORKSPACE</div>
          <div id="command-options" role="listbox" aria-label="Pages">
            {matches.length ? (
              matches.map((item, index) => (
                <button
                  key={item.to}
                  id={`command-option-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  tabIndex={-1}
                  className={`command-result ${index === selected ? 'selected' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => go(item.to)}
                >
                  <item.icon size={19} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <div className="command-no-results">
                No pages match “{query}”. Try energy, alerts, or settings.
              </div>
            )}
          </div>
        </div>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </dialog>
    </>
  )
}
