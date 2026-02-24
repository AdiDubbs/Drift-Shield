import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('button', { name: /run prediction/i }))

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
    fireEvent.click(screen.getByRole('button', { name: /run prediction/i }))

    expect(await screen.findByText('No Definitive Prediction')).toBeInTheDocument()
    expect(screen.getByText('ACTION_ABSTAIN')).toBeInTheDocument()
    expect(screen.getByText('N/A')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /run prediction/i }))

    expect(await screen.findByText('No Definitive Prediction')).toBeInTheDocument()
    expect(screen.getByText('ACTION_FALLBACK')).toBeInTheDocument()
    await waitFor(() => expect(apiClient.predict).toHaveBeenCalledTimes(1))
  })
})
