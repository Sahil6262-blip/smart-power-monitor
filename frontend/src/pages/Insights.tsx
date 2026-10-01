import {
  BrainCircuit,
  ChartNoAxesCombined,
  Fingerprint,
  Leaf,
  Sparkles,
  TrendingUp,
  Waves,
} from 'lucide-react'
import { useResource } from '../hooks/useResource'
import { Badge, ErrorState, Loading, PageHeading, Panel } from '../components/UI'

const features = [
  {
    icon: Fingerprint,
    title: 'Abnormal consumption',
    text: 'Identify unusual usage patterns using a learned baseline.',
    tag: 'Anomaly detection',
  },
  {
    icon: TrendingUp,
    title: 'Daily energy prediction',
    text: 'Estimate daily energy demand from historical patterns.',
    tag: 'Short-term forecast',
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Monthly energy forecast',
    text: 'Anticipate consumption before the next billing cycle.',
    tag: 'Long-term forecast',
  },
  {
    icon: Waves,
    title: 'Peak demand prediction',
    text: 'Understand when your highest demand is likely to occur.',
    tag: 'Load forecasting',
  },
  {
    icon: Leaf,
    title: 'Energy-saving recommendations',
    text: 'Turn validated consumption patterns into useful actions.',
    tag: 'Recommendations',
  },
]
export default function Insights() {
  const result = useResource<{
    status: string
    model_version: string | null
    predictions: unknown[]
    message: string
  }>('/predictions')
  return (
    <div className="page-enter">
      <PageHeading
        title="AI insights"
        action={
          <Badge tone="purple">
            <Sparkles size={13} /> AI module · Future integration
          </Badge>
        }
      />
      {result.error && <ErrorState message={result.error} retry={result.refresh} />}
      <Panel className="ai-hero">
        <div className="ai-orbit">
          <BrainCircuit size={45} />
          <span />
          <span />
        </div>
        <div>
          <Badge tone="purple">A foundation for intelligence</Badge>
          <h2>
            Today’s data.
            <br />
            <span>Tomorrow’s possibilities.</span>
          </h2>
          <p>
            As your energy history grows, it can become the foundation for useful predictions. This
            workspace has no trained model connected yet.
          </p>
        </div>
        <div className="ai-model-status">
          <span className="tiny-dot amber" />
          <strong>Awaiting model</strong>
          <p>No predictions are being generated.</p>
        </div>
      </Panel>
      {result.loading ? (
        <Loading />
      ) : (
        <div className="ai-feature-grid">
          {features.map((f) => (
            <Panel key={f.title}>
              <span className="ai-feature-icon">
                <f.icon size={23} />
              </span>
              <Badge>Not configured</Badge>
              <h2>{f.title}</h2>
              <p>{f.text}</p>
              <div className="ai-placeholder">
                — <span>Available after model integration</span>
              </div>
              <span className="ai-feature-tag">{f.tag}</span>
            </Panel>
          ))}
        </div>
      )}
      <Panel className="ai-honesty">
        <Sparkles size={20} />
        <div>
          <h2>Useful intelligence starts with honest data.</h2>
          <p>
            The current health score and alerts use transparent rules. Predictions will appear here
            only after a real model is trained, validated, and connected.
          </p>
        </div>
      </Panel>
    </div>
  )
}
