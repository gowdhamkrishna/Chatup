import React from 'react';

const Card = ({ children, className = '', title, description, footer, ...props }) => {
    return (
        <div
            className={`bg-card text-card-foreground rounded-2xl border border-border/50 shadow-xl shadow-black/5 backdrop-blur-sm ${className}`}
            {...props}
        >
            {(title || description) && (
                <div className="p-6 border-b border-border/50 space-y-1.5">
                    {title && <h3 className="font-semibold tracking-tight text-xl">{title}</h3>}
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
            )}

            <div className="p-6 pt-6">
                {children}
            </div>

            {footer && (
                <div className="flex items-center p-6 pt-0">
                    {footer}
                </div>
            )}
        </div>
    );
};

export default Card;
