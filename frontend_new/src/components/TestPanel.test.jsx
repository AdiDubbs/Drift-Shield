import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TestPanel from './TestPanel'
import { apiClient } from '../api/client'

vi.mock('../api/client', () => ({
  apiClient: {
    predict: vi.fn(),
  },
}))

const baseResponse = {
  prediction_set: ['fraud'],
  p_fraud: 0.83,
  coverage: 0.95,
  reasons: [],
  model_version: 'v_test',
  drift: {
    drift_score: 0.12,
    soft_drift: false,
    hard_drift: false,
    top_drifted_features: [],
  },
}

describe('TestPanel', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders Fraud Detected when ACTION_PREDICT returns fraud', async () => {
    apiClient.predict.mockResolvedValue({
      ...baseResponse,
      action_code: 'ACTION_PREDICT',
      prediction: 'fraud',
      p_fraud: 0.91,
    })

    render(<TestPanel />)
    fireEvent.click(screen.getAllByRole('button', { name: /^run prediction$/i })[0])

    expect(await screen.findByText('Fraud Detected')).toBeInTheDocument()
    expect(screen.getByText('ACTION_PREDICT')).toBeInTheDocument()
    expect(screen.getByText('91.00%')).toBeInTheDocument()
  })

  it('renders no definitive prediction for ACTION_ABSTAIN', async () => {
    apiClient.predict.mockResolvedValue({
      ...baseResponse,
      action_code: 'ACTION_ABSTAIN',
      prediction: null,
      p_fraud: null,
      prediction_set: ['non_fraud', 'fraud'],
      reasons: ['CONFORMAL_UNCERTAIN_SET_SIZE'],
    })

    render(<TestPanel />)
    fireEvent.click(screen.getAllByRole('button', { name: /^run prediction$/i })[0])

    expect(await screen.findByText('No Definitive Prediction')).toBeInTheDocument()
    expect(screen.getByText('ACTION_ABSTAIN')).toBeInTheDocument()
    expect(screen.getAllByText('N/A')[0]).toBeInTheDocument()
  })

  it('renders no definitive prediction for ACTION_FALLBACK', async () => {
    apiClient.predict.mockResolvedValue({
      ...baseResponse,
      action_code: 'ACTION_FALLBACK',
      prediction: null,
      p_fraud: null,
      prediction_set: [],
      reasons: ['DATA_CONTRACT_VIOLATION'],
    })

    render(<TestPanel />)
    fireEvent.click(screen.getAllByRole('button', { name: /^run prediction$/i })[0])

    expect(await screen.findByText('No Definitive Prediction')).toBeInTheDocument()
    expect(screen.getByText('ACTION_FALLBACK')).toBeInTheDocument()
    await waitFor(() => expect(apiClient.predict).toHaveBeenCalledTimes(1))
  })

  it('submits native JSON payload for schema 2', async () => {
    apiClient.predict.mockResolvedValue({
      ...baseResponse,
      action_code: 'ACTION_PREDICT',
      prediction: 'non_fraud',
      p_fraud: 0.12,
    })

    const view = render(
      <TestPanel
        schemaVersion={2}
        modelInfo={{ active: { feature_names: ['TransactionAmt', 'card1', 'dist1'] } }}
      />
    )

    const scoped = within(view.container)

    fireEvent.change(scoped.getByPlaceholderText('{"feature_a": 0.0, "feature_b": 1.0}'), {
      target: { value: JSON.stringify({ TransactionAmt: 42.5, card1: 12345, dist1: 1.2 }) },
    })
    fireEvent.click(scoped.getByRole('button', { name: /^run prediction$/i }))

    await waitFor(() => expect(apiClient.predict).toHaveBeenCalledTimes(1))
    expect(apiClient.predict).toHaveBeenCalledWith(
      { TransactionAmt: 42.5, card1: 12345, dist1: 1.2 },
      2
    )
  })
})
