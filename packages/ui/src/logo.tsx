interface LogoProps {
  className: string
  href: string
}

export default function logo({ className = ''}: LogoProps) {
  return (
    <div className={`logo ${className}`}>
      <span>Sephduem</span>
    </div>
  )
}