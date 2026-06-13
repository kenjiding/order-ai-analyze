import { Alignment, Fit, Layout, Rive } from '@rive-app/canvas'
import { useCallback, useEffect, useRef } from 'react'

type RiveNumberInput = { value: number }
type RiveBooleanInput = { value: boolean }
type RiveTrigger = { trigger?: () => void; fire?: () => void }

function fireTrigger(t: RiveTrigger | null | undefined) {
  if (!t) return
  if (typeof t.trigger === 'function') {
    t.trigger()
  } else if (typeof t.fire === 'function') {
    t.fire()
  }
}

function validateEmailFormat(email: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
  return emailRegex.test(email)
}

export function useLoginRive() {
  const riveCanvasRef = useRef<HTMLCanvasElement>(null)
  const eyeCanvasRef = useRef<HTMLCanvasElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const riveRef = useRef<Rive | null>(null)
  const eyeRiveRef = useRef<Rive | null>(null)
  const statusInputRef = useRef<RiveNumberInput | null>(null)
  const correctTriggerRef = useRef<RiveTrigger | null>(null)
  const wrongTriggerRef = useRef<RiveTrigger | null>(null)
  const displayInputRef = useRef<RiveBooleanInput | null>(null)

  const syncPasswordVisuals = useCallback(() => {
    const statusInput = statusInputRef.current
    const passwordInput = passwordRef.current
    const emailInput = emailRef.current
    if (!passwordInput) return

    const activeElement = document.activeElement
    const isPasswordFocused = activeElement === passwordInput
    const isPasswordHidden = passwordInput.getAttribute('type') === 'password'

    // 默认睁眼；聚焦密码且为隐藏态时闭眼（等同点击「隐藏密码」）
    if (displayInputRef.current) {
      displayInputRef.current.value = isPasswordFocused && isPasswordHidden
    }

    if (!statusInput) return

    if ((isPasswordFocused && isPasswordHidden) || !isPasswordHidden) {
      // 输入隐藏密码或明文展示时，左侧插画背过去
      statusInput.value = 2
    } else if (activeElement === emailInput) {
      statusInput.value = 1
    } else {
      statusInput.value = 0
    }
  }, [])

  useEffect(() => {
    const canvas = riveCanvasRef.current
    if (!canvas) return

    const r = new Rive({
      src: '/riv/插画.riv',
      canvas,
      stateMachines: 'State Machine 1',
      autoplay: true,
      autoBind: true,
      layout: new Layout({
        fit: Fit.Cover,
        alignment: Alignment.Center,
      }),
      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas()

        const viewModel = r.viewModelByName('Login')
        if (viewModel) {
          const instance = viewModel.defaultInstance()
          if (instance) {
            r.bindViewModelInstance(instance)
            statusInputRef.current = instance.number('status')
            correctTriggerRef.current = instance.trigger('correct')
            wrongTriggerRef.current = instance.trigger('wrong')
          }
        }

        const inputs = r.stateMachineInputs('State Machine 1')
        if (inputs) {
          if (!statusInputRef.current) {
            statusInputRef.current = inputs.find((i) => i.name === 'status') as RiveNumberInput | undefined ?? null
          }
          if (!correctTriggerRef.current) {
            correctTriggerRef.current = inputs.find((i) => i.name === 'correct') as RiveTrigger | undefined ?? null
          }
          if (!wrongTriggerRef.current) {
            wrongTriggerRef.current = inputs.find((i) => i.name === 'wrong') as RiveTrigger | undefined ?? null
          }
        }

        syncPasswordVisuals()
      },
    })

    riveRef.current = r

    return () => {
      r.cleanup()
      riveRef.current = null
    }
  }, [syncPasswordVisuals])

  useEffect(() => {
    const eyeCanvas = eyeCanvasRef.current
    const passwordInput = passwordRef.current
    if (!eyeCanvas || !passwordInput) return

    const eyeRive = new Rive({
      src: '/riv/eyes.riv',
      canvas: eyeCanvas,
      stateMachines: 'State Machine 1',
      autoplay: true,
      autoBind: true,
      onLoad: () => {
        eyeRive.resizeDrawingSurfaceToCanvas()

        const viewModel = eyeRive.viewModelByName('Eyes')
        if (viewModel) {
          const instance = viewModel.defaultInstance()
          if (instance) {
            eyeRive.bindViewModelInstance(instance)
            displayInputRef.current = instance.boolean('display')

            if (displayInputRef.current) {
              displayInputRef.current.value = false
            }
          }
        }
      },
    })

    eyeRiveRef.current = eyeRive

    return () => {
      eyeRive.cleanup()
      eyeRiveRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      riveRef.current?.resizeDrawingSurfaceToCanvas()
      eyeRiveRef.current?.resizeDrawingSurfaceToCanvas()
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!e.isTrusted) return

      const eyeCanvas = eyeCanvasRef.current
      const canvas = riveCanvasRef.current

      if (eyeCanvas) {
        eyeCanvas.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: e.clientX,
            clientY: e.clientY,
            bubbles: false,
          }),
        )
      }

      if (canvas) {
        canvas.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: e.clientX,
            clientY: e.clientY,
            bubbles: false,
          }),
        )
      }
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  const handleEmailFocus = useCallback(() => {
    syncPasswordVisuals()
  }, [syncPasswordVisuals])

  const handleEmailInput = useCallback(() => {
    const email = emailRef.current?.value.trim() ?? ''
    if (validateEmailFormat(email)) {
      fireTrigger(correctTriggerRef.current)
    }
  }, [])

  const handleEmailBlur = useCallback(() => {
    syncPasswordVisuals()
  }, [syncPasswordVisuals])

  const handlePasswordFocus = useCallback(() => {
    syncPasswordVisuals()
  }, [syncPasswordVisuals])

  const handlePasswordBlur = useCallback(() => {
    syncPasswordVisuals()
  }, [syncPasswordVisuals])

  const togglePasswordVisibility = useCallback(() => {
    const passwordInput = passwordRef.current
    if (!passwordInput) return

    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password'
    const length = passwordInput.value.length

    passwordInput.setAttribute('type', type)
    syncPasswordVisuals()
    passwordInput.focus()

    setTimeout(() => {
      passwordInput.setSelectionRange(length, length)
    }, 0)
  }, [syncPasswordVisuals])

  const fireWrongTrigger = useCallback(() => {
    fireTrigger(wrongTriggerRef.current)
  }, [])

  return {
    riveCanvasRef,
    eyeCanvasRef,
    emailRef,
    passwordRef,
    handleEmailFocus,
    handleEmailInput,
    handleEmailBlur,
    handlePasswordFocus,
    handlePasswordBlur,
    togglePasswordVisibility,
    fireWrongTrigger,
    validateEmailFormat,
  }
}
