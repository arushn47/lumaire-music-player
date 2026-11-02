import {it,expect,vi} from 'vitest';
import type {ReactElement,ReactNode} from 'react';
const lookup=vi.hoisted(()=>vi.fn());
vi.mock('../../adapters/native',()=>({library:{lookupCatalog:lookup}}));
import {ArtistLinks} from './ArtistLinks';
import {renderToStaticMarkup} from 'react-dom/server';
function button(node:ReactNode):ReactElement<any>|undefined{
 if(!node||typeof node!=='object')return;
 if(Array.isArray(node))return node.map(button).find(Boolean);
 const element=node as ReactElement<any>;return element.type==='button'?element:button(element.props?.children);
}
it('opens the artist credited on the recording instead of a same-name artist',async()=>{
 lookup.mockResolvedValue({id:'saavn:abcdefgh',artists:[{name:'Gini',id:'saavn:artist:20043211'}]});const navigate=vi.fn();
 const link=button(ArtistLinks({artistString:'Gini',catalogId:'saavn:abcdefgh',onNavigateArtist:navigate}))!;
 link.props.onClick({stopPropagation:vi.fn()});await Promise.resolve();await Promise.resolve();
 expect(navigate).toHaveBeenCalledWith('saavn:artist:20043211');
});
it('does not guess between ambiguous same-name credits',async()=>{
 lookup.mockResolvedValue({id:'saavn:abcdefgh',artists:[{name:'Gini',id:'saavn:artist:1'},{name:'Gini',id:'saavn:artist:2'}]});const navigate=vi.fn();
 button(ArtistLinks({artistString:'Gini',catalogId:'saavn:abcdefgh',onNavigateArtist:navigate}))!.props.onClick({stopPropagation:vi.fn()});await Promise.resolve();await Promise.resolve();
 expect(navigate).toHaveBeenCalledWith('saavn:artist:name:Gini');
});
it('preserves same-name provider IDs and structured band names',()=>{
 const navigate=vi.fn();
 const html=renderToStaticMarkup(ArtistLinks({artists:[{name:'Gini',id:'saavn:artist:1'},{name:'Gini',id:'saavn:artist:2'}],onNavigateArtist:navigate}));
 expect(html.match(/<button/g)).toHaveLength(2);
 const joint=button(ArtistLinks({artists:[{name:'Earth, Wind and Fire',id:'saavn:artist:3'}],onNavigateArtist:navigate}))!;
 expect(joint.props.children).toBe('Earth, Wind and Fire');
 joint.props.onClick({stopPropagation:vi.fn()});
 expect(navigate).toHaveBeenCalledWith('saavn:artist:3');
});
