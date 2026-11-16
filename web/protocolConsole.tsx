import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ProtocolDirection, ProtocolPacket } from '../shared/model.ts'

const MAX_PACKETS = 8000
const directions = [
  { label: 'All', title: 'Show all messages' },
  { label: 'TX', title: 'Show data to BCS' },
  { label: 'RX', title: 'Show data from BCS' },
] as const
const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
})

const PacketLine = memo(function PacketLine({ packet }: { packet: ProtocolPacket }) {
  return <div className="protocol-line" data-direction={packet.direction}>
    <time className="packet-time">{clock.format(packet.at)}</time>
    <span className="packet-direction">{packet.direction}</span>
    <code>{packet.wire}</code>
  </div>
})

export function ProtocolConsole({ onClose }: { onClose: () => void }) {
  const label = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [packets, setPackets] = useState<ProtocolPacket[]>([])
  const [filter, setFilter] = useState<ProtocolDirection | 'All'>('All')
  const [following, setFollowing] = useState(true)
  const [status, setStatus] = useState('Connecting…')

  useEffect(() => {
    dialog.current?.showModal()
    const source = new EventSource('/api/admin/protocol-events')
    source.onopen = () => setStatus('Listening')
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? 'Stream unavailable' : 'Reconnecting…')
    source.addEventListener('packets', event => {
      const received = JSON.parse(event.data) as ProtocolPacket[]
      setPackets(current => [...current, ...received].slice(-MAX_PACKETS))
    })
    source.addEventListener('expired', () => {
      source.close()
      setStatus('Session expired')
    })
    return () => source.close()
  }, [])

  useLayoutEffect(() => {
    if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [following, filter, packets])

  const visible = filter === 'All' ? packets : packets.filter(packet => packet.direction === filter)
  return <dialog ref={dialog} className="protocol-dialog" aria-labelledby={label} onClose={onClose}>
    <div className="protocol-console">
      <header className="protocol-header">
        <h2 id={label}>GVG traffic</h2>
        <button type="button" className="icon-button" aria-label="Close GVG traffic" autoFocus onClick={() => dialog.current?.close()}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="protocol-toolbar">
        <div className="direction-filter" role="group" aria-label="Direction">
          {directions.map(({ label, title }) => <button key={label} type="button" title={title} aria-pressed={filter === label}
            onClick={() => setFilter(label)}>{label}</button>)}
        </div>
        <label className="check"><input type="checkbox" checked={following}
          onChange={event => setFollowing(event.currentTarget.checked)} /> Follow live</label>
        <span className="muted protocol-status" role="status">{status}</span>
      </div>
      <div className="protocol-messages" role="region" aria-label="Protocol messages" tabIndex={0} ref={viewport}>
        {!visible.length && <p className="muted">{filter === 'All' ? 'Waiting for protocol traffic…' : 'Waiting for ' + filter + ' messages…'}</p>}
        {visible.map(packet => <PacketLine key={packet.at + ':' + packet.id} packet={packet} />)}
      </div>
    </div>
  </dialog>
}
