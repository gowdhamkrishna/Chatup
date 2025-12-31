import React from 'react';
import { Loader2 } from 'lucide-react';

const Button = ({
    children,
    variant = 'primary', // primary, secondary, ghost, destructive, outline
    size = 'md', // sm, md, lg
    className = '',
    isLoading = false,
    disabled = false,
    fullWidth = false,
    type = 'button',
    icon: Icon,
    ...props
}) => {
    // Base styles
    const baseStyles = "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";

    // Variants
    const variants = {
        primary: "bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/20 focus:ring-primary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:ring-secondary",
        ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground focus:ring-accent",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90 shadow-md shadow-destructive/20 focus:ring-destructive",
        outline: "border-2 border-input bg-transparent hover:bg-accent hover:text-accent-foreground text-foreground focus:ring-ring"
    };

    // Sizes
    const sizes = {
        sm: "text-xs px-3 py-1.5 gap-1.5",
        md: "text-sm px-5 py-2.5 gap-2",
        lg: "text-base px-6 py-3.5 gap-2.5"
    };

    const widthClass = fullWidth ? 'w-full' : '';

    return (
        <button
            type={type}
            className={`
        ${baseStyles}
        ${variants[variant]}
        ${sizes[size]}
        ${widthClass}
        ${className}
      `}
            disabled={disabled || isLoading}
            {...props}
        >
            {isLoading ? (
                <>
                    <Loader2 className="animate-spin h-4 w-4" />
                    <span>{children}</span>
                </>
            ) : (
                <>
                    {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
                    {children}
                </>
            )}
        </button>
    );
};

export default Button;
