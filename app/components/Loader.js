import React from 'react'
import '../components/loader.css'
const Loader = () => {
  return (
<div className="loader absolute w-[100vw] h-[100vh] bg-black z-10 flex items-center justify-center">
    <span className="bar"></span>
    <span className="bar"></span>
    <span className="bar"></span>
</div>
  )
}

export default Loader   