import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

const AnimatedNumber = ({ value }) => {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)
  const directionRef = useRef(0)

  useEffect(() => {
    if (value === prevRef.current) return
    const prevNum = parseFloat(String(prevRef.current).replace(/,/g, ''))
    const currNum = parseFloat(String(value).replace(/,/g, ''))
    directionRef.current = !isNaN(prevNum) && !isNaN(currNum)
      ? (currNum > prevNum ? -1 : 1)
      : 0
    prevRef.current = value
    setDisplay(value)
  }, [value])

  const dir = directionRef.current
  return (
    <motion.span
      key={String(display)}
      initial={{ opacity: 0, y: dir === -1 ? 8 : dir === 1 ? -8 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      style={{ display: 'inline-block' }}
    >
      {display}
    </motion.span>
  )
}

export default AnimatedNumber
