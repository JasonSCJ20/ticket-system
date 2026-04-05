function FieldWithHint({ help, children }) {
  return (
    <div className="field-with-hint">
      {children}
      {help && <p className="field-hint">{help}</p>}
    </div>
  )
}

export default FieldWithHint
