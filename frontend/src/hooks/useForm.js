import { useState, useCallback } from 'react'

/**
 * useForm Hook
 * Manages form state with automatic reset and error handling
 * 
 * @param {Object} initialValues - Initial form values
 * @param {Function} onSubmit - Callback when form is submitted
 * @returns {Object} Form state and handlers
 */
export function useForm(initialValues, onSubmit) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target
    setValues((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }, [])

  const handleSetValue = useCallback((name, value) => {
    setValues((prev) => ({
      ...prev,
      [name]: value,
    }))
  }, [])

  const handleSetError = useCallback((name, error) => {
    setErrors((prev) => ({
      ...prev,
      [name]: error,
    }))
  }, [])

  const handleReset = useCallback(() => {
    setValues(initialValues)
    setErrors({})
  }, [initialValues])

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault()
      setIsSubmitting(true)
      try {
        await onSubmit(values, setErrors)
        handleReset()
      } catch (err) {
        console.error('Form submission error:', err)
      } finally {
        setIsSubmitting(false)
      }
    },
    [values, onSubmit, handleReset]
  )

  return {
    values,
    errors,
    isSubmitting,
    handleChange,
    handleSetValue,
    handleSetError,
    handleReset,
    handleSubmit,
    setValues,
    setErrors,
  }
}

/**
 * useAsync Hook
 * Manages async operation state (loading, error, data)
 * 
 * @param {Function} asyncFunction - Async function to execute
 * @param {boolean} immediate - Whether to execute immediately on mount
 * @returns {Object} Async operation state and execute function
 */
export function useAsync(asyncFunction, immediate = false) {
  const [status, setStatus] = useState('idle')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const execute = async (...args) => {
    setStatus('pending')
    setData(null)
    setError(null)
    try {
      const response = await asyncFunction(...args)
      setData(response)
      setStatus('success')
      return response
    } catch (err) {
      setError(err)
      setStatus('error')
      throw err
    }
  }

  // Execute function on component mount if immediate is true
  React.useEffect(() => {
    if (immediate) {
      execute()
    }
  }, [])

  return {
    status,
    data,
    error,
    execute,
    isLoading: status === 'pending',
    isError: status === 'error',
    isSuccess: status === 'success',
  }
}

/**
 * useLocalStorage Hook
 * Persist state in localStorage
 * 
 * @param {string} key - localStorage key
 * @param {*} initialValue - Initial value if key doesn't exist
 * @returns {Array} [value, setValue]
 */
export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (err) {
      console.error(`Error reading localStorage key "${key}":`, err)
      return initialValue
    }
  })

  const setValue = useCallback(
    (value) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value
        setStoredValue(valueToStore)
        window.localStorage.setItem(key, JSON.stringify(valueToStore))
      } catch (err) {
        console.error(`Error setting localStorage key "${key}":`, err)
      }
    },
    [key, storedValue]
  )

  return [storedValue, setValue]
}

/**
 * useBusyAction Hook
 * Track busy states for multiple actions
 * 
 * @returns {Object} Busy state handlers
 */
export function useBusyAction() {
  const [busyActions, setBusyActions] = useState({})

  const setActionBusy = useCallback((actionKey, isBusy) => {
    setBusyActions((current) => ({ ...current, [actionKey]: isBusy }))
  }, [])

  const isActionBusy = useCallback((actionKey) => Boolean(busyActions[actionKey]), [busyActions])

  const hasBusyActions = Object.values(busyActions).some(Boolean)

  const runBusyAction = useCallback(
    async (actionKey, operation) => {
      setActionBusy(actionKey, true)
      try {
        return await operation()
      } finally {
        setActionBusy(actionKey, false)
      }
    },
    [setActionBusy]
  )

  return {
    busyActions,
    setActionBusy,
    isActionBusy,
    hasBusyActions,
    runBusyAction,
  }
}

export default {
  useForm,
  useAsync,
  useLocalStorage,
  useBusyAction,
}
