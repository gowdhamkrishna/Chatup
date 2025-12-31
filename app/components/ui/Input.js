import React from 'react';

const Input = ({
    label,
    id,
    type = 'text',
    error,
    icon: Icon,
    className = '',
    containerClassName = '',
    rightElement,
    ...props
}) => {
    return (
        <div className={`space-y-1.5 ${containerClassName}`}>
            {label && (
                <label htmlFor={id} className="block text-sm font-medium text-muted-foreground ml-1">
                    {label}
                </label>
            )}

            <div className="relative group">
                {Icon && (
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors duration-200">
                        <Icon className="h-5 w-5" />
                    </div>
                )}

                <input
                    id={id}
                    type={type}
                    className={`
            flex w-full rounded-xl border-2 border-input bg-background/50 px-3 py-2.5 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:border-primary/50 focus-visible:shadow-[0_0_0_2px_rgba(var(--primary),0.1)] transition-all duration-200
            ${Icon ? 'pl-10' : ''}
            ${error ? 'border-destructive focus-visible:border-destructive' : ''}
            ${className}
          `}
                    {...props}
                />

                {rightElement && (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                        {rightElement}
                    </div>
                )}
            </div>

            {error && (
                <p className="text-xs text-destructive font-medium ml-1 animate-in">
                    {error}
                </p>
            )}
        </div>
    );
};

export default Input;
