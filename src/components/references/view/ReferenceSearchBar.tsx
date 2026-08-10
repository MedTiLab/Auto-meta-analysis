import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Tag } from 'lucide-react';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
import type { ReferenceTag } from '../types';

interface ReferenceSearchBarProps {
  onSearch: (query: string, tags: string[]) => void;
  tags: ReferenceTag[];
}

export default function ReferenceSearchBar({ onSearch, tags }: ReferenceSearchBarProps) {
  const { t } = useTranslation('references');
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleTextSearch = useCallback(
    (newQuery: string, newTags: string[]) => {
      setQuery(newQuery);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(newQuery, newTags);
      }, 300);
    },
    [onSearch],
  );

  const toggleTag = useCallback(
    (tag: string) => {
      const next = selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag];
      setSelectedTags(next);
      // Tag toggles fire immediately (bypass debounce)
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSearch(query, next);
    },
    [selectedTags, query, onSearch],
  );

  const clearAll = useCallback(() => {
    setQuery('');
    setSelectedTags([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch('', []);
  }, [onSearch]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleTextSearch(e.target.value, selectedTags)}
            placeholder={t('search.placeholder')}
            className="pl-9 pr-9"
          />
          {(query || selectedTags.length > 0) && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={clearAll}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTags(!showTags)}
            className="flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-muted/50"
          >
            <Tag className="h-3.5 w-3.5" />
            {selectedTags.length > 0 && (
              <span className="text-xs font-medium text-primary">{selectedTags.length}</span>
            )}
          </button>
        )}
      </div>

      {showTags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/40 bg-muted/20 p-2">
          {tags.slice(0, 30).map((tag) => (
            <Badge
              key={tag.tag}
              variant={selectedTags.includes(tag.tag) ? 'default' : 'outline'}
              className="cursor-pointer text-[10px]"
              onClick={() => toggleTag(tag.tag)}
            >
              {tag.tag} ({tag.count})
            </Badge>
          ))}
        </div>
      )}

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="cursor-pointer gap-1 text-[10px]"
              onClick={() => toggleTag(tag)}
            >
              {tag}
              <X className="h-2.5 w-2.5" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
